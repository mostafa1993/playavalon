/**
 * Azure Speech-to-Text client (conversation/single-shot REST endpoint).
 *
 * Input: PCM16 mono @ `sampleRate` Hz (no header).
 * Output: transcript string + optional confidence.
 *
 * Endpoint reference:
 *   POST https://<region>.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1
 *   ?language=fa-IR&format=detailed
 *
 * Request body must be a valid WAV (RIFF) container. We wrap the raw PCM16
 * samples with a 44-byte WAV header.
 *
 * The single-shot endpoint handles audio up to ~60s. The Avalon speaking timer
 * caps turns at 55s (TIMER_DURATION=50 + AUTO_MUTE_DELAY=5), so this fits.
 */

export interface AzureSpeechConfig {
  key: string;
  region: string;
  language: string;
}

export interface TranscribeResult {
  transcript: string;
  confidence: number | null;
  raw: unknown;
}

export async function transcribe(
  config: AzureSpeechConfig,
  pcm: Int16Array,
  sampleRate: number
): Promise<TranscribeResult> {
  const wav = pcmToWav(pcm, sampleRate, 1);

  const url = `https://${config.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(config.language)}&format=detailed`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': config.key,
      'Content-Type': `audio/wav; codecs=audio/pcm; samplerate=${sampleRate}`,
      Accept: 'application/json',
    },
    body: wav,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Azure Speech ${res.status}: ${body.slice(0, 300)}`);
  }

  const payload = (await res.json()) as AzureSttResponse;

  // Success vs non-success: 'Success' is the canonical good case; 'NoMatch'
  // means no speech detected — return empty transcript rather than throwing.
  if (payload.RecognitionStatus === 'Success') {
    const best = payload.NBest?.[0];
    return {
      transcript: best?.Display ?? payload.DisplayText ?? '',
      confidence: typeof best?.Confidence === 'number' ? best.Confidence : null,
      raw: payload,
    };
  }
  if (payload.RecognitionStatus === 'NoMatch') {
    return { transcript: '', confidence: null, raw: payload };
  }
  throw new Error(`Azure Speech status=${payload.RecognitionStatus}`);
}

interface AzureSttResponse {
  RecognitionStatus: string;
  DisplayText?: string;
  Offset?: number;
  Duration?: number;
  NBest?: Array<{
    Confidence?: number;
    Lexical?: string;
    ITN?: string;
    MaskedITN?: string;
    Display?: string;
  }>;
}

/** Wrap raw PCM16 samples in a canonical 44-byte RIFF/WAV header. */
function pcmToWav(pcm: Int16Array, sampleRate: number, channels: number): Uint8Array {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.byteLength;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);        // PCM chunk size
  view.setUint16(20, 1, true);         // audio format (1 = PCM)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const out = new Uint8Array(header.byteLength + dataSize);
  out.set(new Uint8Array(header), 0);
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 44);
  return out;
}

function writeAscii(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
}
