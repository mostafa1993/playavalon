/**
 * Env-var resolution + constants for the AI reviewer agent.
 * Throws on startup if a required var is missing.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v : fallback;
}

export interface AgentConfig {
  supabase: {
    url: string;
    serviceRoleKey: string;
  };
  livekit: {
    url: string;
    apiKey: string;
    apiSecret: string;
    botIdentityPrefix: string;
  };
  azureSpeech: {
    key: string;
    region: string;
    language: string;
  };
  storage: {
    dataDir: string;
  };
  polling: {
    gameWatcherMs: number;
  };
  audio: {
    /** Target sample rate we tell LiveKit to deliver at (and pass to Azure). */
    sampleRate: number;
    channels: number;
  };
}

export function loadConfig(): AgentConfig {
  return {
    supabase: {
      url: required('SUPABASE_URL'),
      serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    },
    livekit: {
      url: required('LIVEKIT_URL'),
      apiKey: required('LIVEKIT_API_KEY'),
      apiSecret: required('LIVEKIT_API_SECRET'),
      botIdentityPrefix: optional('LIVEKIT_BOT_IDENTITY_PREFIX', 'reviewer-'),
    },
    azureSpeech: {
      key: required('AZURE_SPEECH_KEY'),
      region: required('AZURE_SPEECH_REGION'),
      language: optional('AZURE_SPEECH_LANGUAGE', 'fa-IR'),
    },
    storage: {
      dataDir: optional('DATA_DIR', '/data/games'),
    },
    polling: {
      gameWatcherMs: Number.parseInt(optional('GAME_WATCHER_INTERVAL_MS', '3000'), 10),
    },
    audio: {
      sampleRate: Number.parseInt(optional('AUDIO_SAMPLE_RATE', '16000'), 10),
      channels: 1,
    },
  };
}
