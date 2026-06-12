/**
 * Azure Speech client — STT (speech→text) and TTS (text→speech) over REST.
 *
 * STT: conversation/single-shot endpoint.
 *   Input: PCM16 mono @ `sampleRate` Hz (no header) — wrapped in a 44-byte
 *   RIFF/WAV header. Output: transcript string + optional confidence.
 *   Handles audio up to ~60s; the Avalon speaking timer caps turns at 55s
 *   (TIMER_DURATION=50 + AUTO_MUTE_DELAY=5), so this fits.
 *
 * TTS: cognitiveservices/v1 synthesis endpoint.
 *   Input: text + a neural voice name (SSML built + escaped here).
 *   Output: raw PCM16 mono Int16Array at the requested sample rate —
 *   ready for LiveKit's AudioSource (see livekitAudio.ts).
 *
 * Both retry transient failures (network, 429, 5xx) with exponential backoff;
 * auth/4xx errors are treated as permanent and surfaced immediately.
 */

import { isNetworkError, isTransientHttpStatus, retry } from './retry.js';

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

export interface TranscribeOptions {
  retry?: {
    maxAttempts?: number;
    baseDelayMs?: number;
  };
}

/**
 * Wrapper around Azure failures so `shouldRetry` can distinguish HTTP errors
 * (which may be transient) from payload-level errors (which aren't).
 *
 *   - httpStatus set: transport-layer failure — retry on 408/429/5xx.
 *   - payloadStatus set: Azure returned 200 but `RecognitionStatus` signaled
 *     an error (`Error`, `InitialSilenceTimeout`, `BabbleTimeout`, etc.).
 *     Never retried — these are deterministic given the input audio.
 */
class AzureSpeechError extends Error {
  readonly httpStatus: number | null;
  readonly payloadStatus: string | null;
  constructor(
    init: { httpStatus: number } | { payloadStatus: string },
    message: string
  ) {
    super(message);
    this.name = 'AzureSpeechError';
    this.httpStatus = 'httpStatus' in init ? init.httpStatus : null;
    this.payloadStatus = 'payloadStatus' in init ? init.payloadStatus : null;
  }
}

export async function transcribe(
  config: AzureSpeechConfig,
  pcm: Int16Array,
  sampleRate: number,
  options: TranscribeOptions = {}
): Promise<TranscribeResult> {
  const wav = pcmToWav(pcm, sampleRate, 1);

  const url = `https://${config.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(config.language)}&format=detailed`;

  const attempt = async (): Promise<TranscribeResult> => {
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
      throw new AzureSpeechError(
        { httpStatus: res.status },
        `Azure Speech ${res.status}: ${body.slice(0, 300)}`
      );
    }

    const payload = (await res.json()) as AzureSttResponse;
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
    // Other statuses (InitialSilenceTimeout, BabbleTimeout, Error, etc.) are
    // non-transient — retrying won't help.
    throw new AzureSpeechError(
      { payloadStatus: payload.RecognitionStatus },
      `Azure Speech status=${payload.RecognitionStatus}`
    );
  };

  return retry(attempt, {
    maxAttempts: options.retry?.maxAttempts,
    baseDelayMs: options.retry?.baseDelayMs,
    shouldRetry: (err) => {
      if (err instanceof AzureSpeechError) {
        // Only retry transport-layer transient statuses. Payload-level Azure
        // errors are deterministic for the given input audio.
        return err.httpStatus !== null && isTransientHttpStatus(err.httpStatus);
      }
      return isNetworkError(err);
    },
    onRetry: (err, attempt, delayMs) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[stt] retry ${attempt} after ${delayMs}ms — ${msg}`);
    },
  });
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

// ── TTS ─────────────────────────────────────────────────────────────────────

export interface SynthesizeOptions {
  /** Azure neural voice, e.g. 'fa-IR-DilaraNeural' (female) / 'fa-IR-FaridNeural' (male). */
  voice: string;
  /** Output PCM sample rate. 48000 matches LiveKit/WebRTC natively. */
  sampleRate?: 16000 | 24000 | 48000;
  /** xml:lang for the SSML envelope; defaults to the config language. */
  language?: string;
  retry?: {
    maxAttempts?: number;
    baseDelayMs?: number;
  };
}

/**
 * Synthesize speech: text → raw PCM16 mono Int16Array.
 * Proven in the Phase-0 spike (docs/2026-06-10-llm-voice-player-plan.md).
 */
export async function synthesize(
  config: AzureSpeechConfig,
  text: string,
  options: SynthesizeOptions
): Promise<Int16Array> {
  const sampleRate = options.sampleRate ?? 48000;
  const lang = options.language ?? config.language;
  const format = `raw-${sampleRate / 1000}khz-16bit-mono-pcm`;
  const ssml =
    `<speak version='1.0' xml:lang='${escapeXml(lang)}'>` +
    `<voice name='${escapeXml(options.voice)}'>${escapeXml(text)}</voice></speak>`;

  const url = `https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`;

  const attempt = async (): Promise<Int16Array> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': config.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': format,
        'User-Agent': 'playavalon-agents',
      },
      body: ssml,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AzureSpeechError(
        { httpStatus: res.status },
        `Azure TTS ${res.status}: ${body.slice(0, 300)}`
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  };

  return retry(attempt, {
    maxAttempts: options.retry?.maxAttempts,
    baseDelayMs: options.retry?.baseDelayMs,
    shouldRetry: (err) => {
      if (err instanceof AzureSpeechError) {
        return err.httpStatus !== null && isTransientHttpStatus(err.httpStatus);
      }
      return isNetworkError(err);
    },
    onRetry: (err, attempt, delayMs) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[tts] retry ${attempt} after ${delayMs}ms — ${msg}`);
    },
  });
}

/** Escape the five XML special characters for safe SSML embedding. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;');
}
