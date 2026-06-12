/**
 * @avalon/shared — common library for the playavalon agents
 * (the AI reviewer and the bot players).
 */

export { createLLMClient, type LLMClient, type LLMClientOptions, type PromptVars } from './llm.js';
export { loadPrompt, fill, type PromptFile } from './prompts.js';
export { retry, isNetworkError, isTransientHttpStatus, type RetryOptions } from './retry.js';
export {
  transcribe,
  synthesize,
  type AzureSpeechConfig,
  type TranscribeResult,
  type TranscribeOptions,
  type SynthesizeOptions,
} from './azureSpeech.js';
export { computeRms, isSilent } from './silence.js';
export { publishAudioTrack, type AudioPublisher, type PublishAudioOptions } from './livekitAudio.js';
