/**
 * Live speech recognition (plan 2026-11-15-2100, D1): a session takes a
 * person's audio while they speak and gives the words phrase by phrase; when
 * the audio is closed, the last phrase comes about a second later.
 *
 * Azure Speech continuous recognition from a pushed 16-bit mono stream, with
 * the same key, region and language as the rest of the bots' speech.
 */

import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

export interface LiveSession {
  /** Audio as it comes, 16-bit mono at the factory's sample rate. */
  write(pcm: Int16Array): void;
  /**
   * Close the audio and wait for the last phrase: every phrase recognised,
   * joined. Rejects if the session failed (the caller falls back to whole-clip
   * transcription).
   */
  end(): Promise<string>;
}

export interface SessionEvents {
  /** A phrase is recognised (the speaker paused or the audio ended). */
  onPhrase?: (text: string) => void;
  /** Words are being recognised: the person is talking. */
  onSpeaking?: () => void;
}

export interface RecognizerFactory {
  open(events?: SessionEvents): LiveSession;
}

/** How long `end()` waits for the service after the audio is closed. */
const END_WAIT_MS = 6_000;

export function azureRecognizers(config: { key: string; region: string; language: string; sampleRate: number }): RecognizerFactory {
  const speechConfig = sdk.SpeechConfig.fromSubscription(config.key, config.region);
  speechConfig.speechRecognitionLanguage = config.language;
  const format = sdk.AudioStreamFormat.getWaveFormatPCM(config.sampleRate, 16, 1);

  return {
    open(events: SessionEvents = {}): LiveSession {
      const stream = sdk.AudioInputStream.createPushStream(format);
      const recognizer = new sdk.SpeechRecognizer(speechConfig, sdk.AudioConfig.fromStreamInput(stream));
      const phrases: string[] = [];
      let failure: string | null = null;
      let closed = false;
      let markStopped: () => void = () => {};
      const stopped = new Promise<void>((resolve) => {
        markStopped = resolve;
      });

      recognizer.recognizing = () => events.onSpeaking?.();
      recognizer.recognized = (_s, e) => {
        if (e.result.reason !== sdk.ResultReason.RecognizedSpeech) return;
        const text = e.result.text.trim();
        if (!text) return;
        phrases.push(text);
        events.onPhrase?.(text);
      };
      recognizer.canceled = (_s, e) => {
        // EndOfStream is the normal end of a pushed stream; anything else failed.
        if (e.reason === sdk.CancellationReason.Error) failure = `${e.errorCode}: ${e.errorDetails}`;
        markStopped();
      };
      recognizer.sessionStopped = () => markStopped();
      recognizer.startContinuousRecognitionAsync(
        () => {},
        (err) => {
          failure = `could not start: ${err}`;
          markStopped();
        }
      );

      return {
        write(pcm: Int16Array): void {
          if (closed || failure) return;
          stream.write(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer);
        },
        async end(): Promise<string> {
          if (!closed) {
            closed = true;
            stream.close();
          }
          await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, END_WAIT_MS))]);
          recognizer.close();
          if (failure) throw new Error(failure);
          return phrases.join(' ');
        },
      };
    },
  };
}
