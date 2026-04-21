#
# End-to-end test: record → Azure STT → Gemini post-correction.
#
# Prereqs (one-time):
#   1. A test.wav or test.ogg file in this dir. Record with either:
#        arecord -f S16_LE -r 16000 -c 1 -d 5 test.wav
#        ffmpeg -f pulse -i default -c:a libopus -b:a 32k -ac 1 -t 5 test.ogg
#      then speak Persian.
#   2. `jq` installed (apt install jq).
#   3. `gcloud` CLI installed + authenticated with a service account that has
#      Vertex AI User role. Easiest:
#        gcloud auth activate-service-account \
#          --key-file=/home/amordad/.config/gcp-application-credentials.json
#
# Run with:  bash test.sh
# Optional:  bash test.sh path/to/other.wav   (override the input file)

# ----- Fill these in -----
AZURE_SPEECH_KEY=xxx
AZURE_SPEECH_REGION=eastus

GCP_PROJECT_ID=xxx
GCP_LLM_MODEL=gemini-3.1-pro-preview
GCP_LLM_LOCATION=global

# Host path (NOT the /run/secrets/... Docker path — that's only valid inside the agent container).
export GOOGLE_APPLICATION_CREDENTIALS=/home/amordad/.config/gcp-application-credentials.json
# --------------------------

# ---------- Step 1: Azure STT ----------
# Pick the input file: explicit arg wins, else test.wav, else test.ogg.
audio_file="${1:-}"
if [ -z "$audio_file" ]; then
  if   [ -f test.wav ]; then audio_file="test.wav"
  elif [ -f test.ogg ]; then audio_file="test.ogg"
  else
    echo "No test.wav or test.ogg found in this directory."
    echo "Record one first, e.g.:"
    echo "  arecord -f S16_LE -r 16000 -c 1 -d 5 test.wav"
    exit 1
  fi
fi
if [ ! -f "$audio_file" ]; then
  echo "Audio file not found: $audio_file"
  exit 1
fi

# Pick Content-Type from extension (lowercased).
ext="${audio_file##*.}"
ext="${ext,,}"
case "$ext" in
  wav)  content_type="audio/wav; codecs=audio/pcm; samplerate=16000" ;;
  ogg)  content_type="audio/ogg; codecs=opus" ;;
  *)    echo "Unsupported audio extension: .$ext (use .wav or .ogg)"; exit 1 ;;
esac

echo "=== 1. Azure Speech-to-Text ==="
echo "    input: $audio_file ($content_type)"
stt=$(curl -sS -X POST \
  "https://${AZURE_SPEECH_REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=fa-IR&format=detailed" \
  -H "Ocp-Apim-Subscription-Key: ${AZURE_SPEECH_KEY}" \
  -H "Content-Type: $content_type" \
  --data-binary @"$audio_file")

echo "$stt" | jq .

transcript=$(echo "$stt" | jq -r '.DisplayText // empty')
if [ -z "$transcript" ]; then
  echo "No DisplayText — aborting."
  exit 1
fi

echo
echo "--- Raw transcript ---"
echo "$transcript"
echo

# ---------- Step 2: GCP access token ----------
# Uses Application Default Credentials via GOOGLE_APPLICATION_CREDENTIALS set above.
# No need to `gcloud auth activate-service-account` first — the env var is enough.
access_token=$(gcloud auth application-default print-access-token 2>/dev/null || true)
if [ -z "$access_token" ]; then
  cat <<EOF
Failed to get a GCP access token.

Make sure:
  - gcloud CLI is installed (apt install google-cloud-cli)
  - GOOGLE_APPLICATION_CREDENTIALS above points to a valid service-account JSON
  - that file's path is readable: ls -l "\$GOOGLE_APPLICATION_CREDENTIALS"
EOF
  exit 1
fi

# ---------- Step 3: Gemini correction ----------
echo "=== 2. Gemini post-correction ==="

body=$(jq -n --arg t "$transcript" '{
  systemInstruction: {
    role: "system",
    parts: [{text: "You are a Persian (fa-IR) proofreader specialized in fixing speech-to-text transcription errors. The input is a raw Persian STT transcript that may contain: misheard words, wrong verb conjugations (wrong person/tense), missing or extra words, homophone confusions, and incorrect Persian spacing (zero-width non-joiner / half-space issues). Produce a corrected Persian version that best matches what the speaker likely intended. Preserve meaning and tone. Do NOT translate. Return ONLY the corrected Persian text, no explanations, no quotes."}]
  },
  contents: [{
    role: "user",
    parts: [{text: $t}]
  }],
  generationConfig: {
    temperature: 0.2,
    maxOutputTokens: 8000
  }
}')

# The global endpoint is hosted at aiplatform.googleapis.com (no location prefix);
# regional endpoints are at <location>-aiplatform.googleapis.com.
if [ "${GCP_LLM_LOCATION}" = "global" ]; then
  vertex_host="aiplatform.googleapis.com"
else
  vertex_host="${GCP_LLM_LOCATION}-aiplatform.googleapis.com"
fi
vertex_url="https://${vertex_host}/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_LLM_LOCATION}/publishers/google/models/${GCP_LLM_MODEL}:generateContent"

resp=$(curl -sS -X POST "$vertex_url" \
  -H "Authorization: Bearer ${access_token}" \
  -H "Content-Type: application/json" \
  -d "$body")

corrected=$(echo "$resp" | jq -r '.candidates[0].content.parts[0].text // empty' 2>/dev/null || true)
if [ -z "$corrected" ]; then
  echo "Vertex call did not return text."
  echo "URL: $vertex_url"
  echo "--- raw response ---"
  echo "$resp"
  echo "--------------------"
  exit 1
fi

echo "--- Corrected transcript ---"
echo "$corrected"
echo

# ---------- Side-by-side ----------
echo "=== Compare ==="
echo "Raw:        $transcript"
echo "Corrected:  $corrected"
