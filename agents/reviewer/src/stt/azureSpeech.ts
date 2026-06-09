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
 *
 * Retries transient failures (network, 429, 5xx) with exponential backoff;
 * auth/4xx errors are treated as permanent and surfaced immediately.
 */

import { isNetworkError, isTransientHttpStatus, retry } from '../util/retry.js';

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
