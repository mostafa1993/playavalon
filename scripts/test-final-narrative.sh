#
# End-to-end test: final-narrative Gemini call only.
#
# This is a "bypass-audio" test for the HIGHEST-RISK step of the review agent
# pipeline — generating the long-form Persian narrative at game end. It uses
# hand-crafted fixtures under ./test-final-narrative/ that mimic what the real
# pipeline would accumulate (dossiers, quest syntheses, etc.), and sends the
# exact same prompt the agent sends to Vertex AI.
#
# Why this test:
#   - The real game pipeline can't be exercised without 5 players + mics.
#   - STT + correction are already validated by test-sst.sh.
#   - The final-narrative prompt is where Gemini is most likely to refuse
#     (Avalon dialogue is nothing but accusations and "kill Merlin"). If it
#     passes safety here, the full pipeline will almost certainly work in a
#     real game.
#
# Prereqs:
#   1. `jq` installed (apt install jq).
#   2. `node` available, and `agent/node_modules/js-yaml` installed (run
#      `cd agent && npm install` if not).
#   3. `gcloud` CLI installed and either:
#        - GOOGLE_APPLICATION_CREDENTIALS points to a service-account JSON, or
#        - `gcloud auth application-default login` has been run.
#      The service account needs Vertex AI User role.
#
# Run:
#   bash scripts/test-final-narrative.sh          # Persian (default)
#   bash scripts/test-final-narrative.sh fa       # Persian
#   bash scripts/test-final-narrative.sh en       # English

# ----- Fill these in -----
GCP_PROJECT_ID=gen-lang-client-0823734605
GCP_LLM_LOCATION=global

# Host path (NOT the /run/secrets/... Docker path).
export GOOGLE_APPLICATION_CREDENTIALS=/home/amordad/.config/gcp-application-credentials.json
# --------------------------

set -euo pipefail

LANG_CODE="${1:-fa}"
if [ "$LANG_CODE" != "fa" ] && [ "$LANG_CODE" != "en" ]; then
  echo "Language must be 'fa' or 'en'. Got: $LANG_CODE"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/../agent" && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/test-final-narrative"
PROMPT_FILE="$AGENT_DIR/prompts/final-narrative-${LANG_CODE}.yml"

for f in meta.json outcome.json dossiers.json quests.json; do
  if [ ! -f "$FIXTURES_DIR/$f" ]; then
    echo "Missing fixture: $FIXTURES_DIR/$f"
    exit 1
  fi
done
if [ ! -f "$PROMPT_FILE" ]; then
  echo "Prompt file not found: $PROMPT_FILE"
  exit 1
fi

echo "=== 1. Loading prompt + fixtures ==="
echo "    prompt:    $PROMPT_FILE"
echo "    fixtures:  $FIXTURES_DIR"
echo

# Parse the YAML prompt using the agent's own js-yaml install, so the test
# uses EXACTLY the same loader the agent uses in production.
prompt_json=$(cd "$AGENT_DIR" && node -e '
  const yaml = require("js-yaml");
  const fs = require("fs");
  const doc = yaml.load(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(JSON.stringify({
    system: doc.system,
    user: doc.user,
    model: doc.model || null,
    temperature: typeof doc.temperature === "number" ? doc.temperature : 0.4,
    maxOutputTokens: typeof doc.max_output_tokens === "number" ? doc.max_output_tokens : 4096,
    responseMimeType: doc.response_mime_type || null,
  }));
' "$PROMPT_FILE")

system_text=$(echo "$prompt_json" | jq -r '.system')
user_template=$(echo "$prompt_json" | jq -r '.user')
temperature=$(echo "$prompt_json" | jq -r '.temperature')
max_output_tokens=$(echo "$prompt_json" | jq -r '.maxOutputTokens')
model=$(echo "$prompt_json" | jq -r '.model // "gemini-3.1-pro-preview"')

echo "    model:        $model"
echo "    temperature:  $temperature"
echo "    max tokens:   $max_output_tokens"
echo

# Load fixtures as stringified JSON (pretty-printed, matching agent code).
meta=$(jq . "$FIXTURES_DIR/meta.json")
outcome=$(jq . "$FIXTURES_DIR/outcome.json")
dossiers=$(jq . "$FIXTURES_DIR/dossiers.json")
quests=$(jq . "$FIXTURES_DIR/quests.json")
if [ -f "$FIXTURES_DIR/discussion.json" ]; then
  discussion=$(jq . "$FIXTURES_DIR/discussion.json")
else
  discussion="null"
fi

# Fill the {{var}} placeholders. Same regex as agent/src/reviewer/prompts.ts.
user_text=$(node -e '
  const tpl = process.argv[1];
  const vars = {
    meta: process.argv[2],
    outcome: process.argv[3],
    dossiers: process.argv[4],
    quests: process.argv[5],
    discussion: process.argv[6],
  };
  process.stdout.write(tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] !== undefined ? vars[k] : m));
' "$user_template" "$meta" "$outcome" "$dossiers" "$quests" "$discussion")

# Build Vertex generateContent body with jq for safe JSON escaping.
body=$(jq -n \
  --arg sys "$system_text" \
  --arg usr "$user_text" \
  --argjson temp "$temperature" \
  --argjson maxt "$max_output_tokens" \
  '{
    systemInstruction: { role: "system", parts: [{ text: $sys }] },
    contents: [{ role: "user", parts: [{ text: $usr }] }],
    generationConfig: {
      temperature: $temp,
      maxOutputTokens: $maxt
    }
  }')

# ---------- GCP access token ----------
access_token=$(gcloud auth application-default print-access-token 2>/dev/null || true)
if [ -z "$access_token" ]; then
  cat <<EOF
Failed to get a GCP access token.
Make sure:
  - gcloud CLI is installed
  - GOOGLE_APPLICATION_CREDENTIALS above points to a valid service-account JSON
  - that file is readable: ls -l "\$GOOGLE_APPLICATION_CREDENTIALS"
EOF
  exit 1
fi

# ---------- Vertex URL ----------
if [ "$GCP_LLM_LOCATION" = "global" ]; then
  vertex_host="aiplatform.googleapis.com"
else
  vertex_host="${GCP_LLM_LOCATION}-aiplatform.googleapis.com"
fi
vertex_url="https://${vertex_host}/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_LLM_LOCATION}/publishers/google/models/${model}:generateContent"

echo "=== 2. Calling Vertex ==="
echo "    url: $vertex_url"
echo

resp=$(curl -sS -X POST "$vertex_url" \
  -H "Authorization: Bearer ${access_token}" \
  -H "Content-Type: application/json" \
  -d "$body")

# ---------- Report ----------
echo "=== 3. Safety / finish metadata ==="
echo "$resp" | jq '{
  finishReason: .candidates[0].finishReason,
  blockReason: .promptFeedback.blockReason,
  safetyRatings: .candidates[0].safetyRatings,
  usageMetadata: .usageMetadata
}'
echo

text=$(echo "$resp" | jq -r '.candidates[0].content.parts[0].text // empty')

if [ -z "$text" ]; then
  echo "=== 4. Narrative output ==="
  echo "NO TEXT RETURNED. Full response saved to /tmp/test-final-narrative-response.json"
  echo "$resp" > /tmp/test-final-narrative-response.json
  echo
  echo "First 500 chars of raw response:"
  echo "$resp" | head -c 500
  echo
  exit 1
fi

echo "=== 4. Narrative output ($LANG_CODE) ==="
echo "$text"
echo
echo "=== 5. Length ==="
echo "    chars: $(echo -n "$text" | wc -c)"
echo "    words: $(echo -n "$text" | wc -w)"
