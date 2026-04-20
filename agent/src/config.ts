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

/** Read a required env var, checking `primary` first, then `alternatives`. */
function requiredOneOf(primary: string, ...alternatives: string[]): string {
  for (const name of [primary, ...alternatives]) {
    const v = process.env[name];
    if (v && v.trim().length > 0) return v;
  }
  throw new Error(
    `Missing required env var: set one of ${[primary, ...alternatives].join(', ')}`
  );
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
  gemini: {
    project: string;
    location: string;
    model: string;
  };
  storage: {
    dataDir: string;
    promptsDir: string;
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
      // The Next.js app uses NEXT_PUBLIC_SUPABASE_URL; accept either.
      url: requiredOneOf('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'),
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
    gemini: {
      project: required('GCP_PROJECT_ID'),
      location: optional('GCP_VERTEX_LOCATION', 'us-central1'),
      model: optional('GEMINI_MODEL', 'gemini-2.5-pro'),
    },
    storage: {
      dataDir: optional('DATA_DIR', '/data/games'),
      // Relative path resolves to CWD: /app/prompts in the Docker image
      // (WORKDIR /app) and ./prompts locally when running `npm run dev`.
      promptsDir: optional('PROMPTS_DIR', './prompts'),
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
