/**
 * @avalon/shared — common library for the playavalon agents
 * (the AI reviewer and the bot players).
 */

export { createLLMClient, isGemini4, samplingFor, type LLMClient, type LLMClientOptions, type ModelOverride, type PromptVars } from './llm.js';
export { loadPrompt, fill, THINKING_LEVELS, type PromptFile, type ThinkingLevelName } from './prompts.js';
export { retry, isNetworkError, isTransientHttpStatus, type RetryOptions } from './retry.js';
export {
  transcribe,
  synthesize,
  type AzureSpeechConfig,
  type TranscribeResult,
  type TranscribeOptions,
  type SynthesizeOptions,
} from './azureSpeech.js';
export {
  computeRms,
  isSilent,
  loudestWindowRms,
  splitAtQuietest,
  voicedSpan,
  type ClipPiece,
} from './silence.js';
export { publishAudioTrack, type AudioPublisher, type PublishAudioOptions } from './livekitAudio.js';
export {
  TimerListener,
  TIMER_TOPIC,
  type SpeakingTimerState,
  type ParticipantResolver,
  type QuestChangeHandler,
  type RoundChangeHandler,
} from './timerListener.js';
export { TurnSegmenter, type RecordedTurn, type TurnFinishedHandler } from './turnSegmenter.js';
export {
  readRoleConfig,
  summarizeRoleConfig,
  roleCounts,
  formatRolesInPlay,
  type PublicRoleConfig,
  type RolesInPlay,
  type RoleCount,
} from './roleConfig.js';
export {
  DiscussionRecorder,
  type RecordedDiscussion,
  type RecordedDiscussionSegment,
  type DiscussionFinishedHandler,
} from './discussionRecorder.js';
export { DiscussionListener, DISCUSSION_TIMER_TOPIC, type DisplayNameResolver } from './discussionListener.js';
export { LiveKitListener, type ListenerOptions, type ListenerEvents } from './livekitListener.js';
export { isLiveKitHandleError, tolerateLiveKitHandleErrors } from './nativeErrors.js';
