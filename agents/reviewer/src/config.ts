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

/** Parse an int env var, falling back on missing/invalid input. */
function intEnv(name: string, fallback: number, min?: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    console.warn(`[config] ${name}="${raw}" is not a valid integer; using default ${fallback}`);
    return fallback;
  }
  return min !== undefined ? Math.max(min, parsed) : parsed;
}

/** Parse a float env var, falling back on missing/invalid input. */
function floatEnv(name: string, fallback: number, min?: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(`[config] ${name}="${raw}" is not a valid number; using default ${fallback}`);
    return fallback;
  }
  return min !== undefined ? Math.max(min, parsed) : parsed;
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
    /** RMS threshold (PCM16 units) below which a turn is considered silent and STT is skipped. */
    silenceRmsThreshold: number;
  };
  retry: {
    /** Total attempts (including the first) for retriable external calls. */
    maxAttempts: number;
    /** Base delay in ms; doubled each attempt with jitter. */
    baseDelayMs: number;
  };
  correction: {
    /** If true, run an LLM proofreading pass on each raw STT transcript before
     *  it reaches the summarizer. Improves quality for Persian; costs one
     *  extra LLM call (Gemini Flash by default) per non-empty turn. */
    enabled: boolean;
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
      location: optional('GCP_LLM_LOCATION', 'us-central1'),
      // Currently only Gemini models work here (the SDK is @google-cloud/vertexai).
      // The env var is named generically so we can swap to a different Vertex-hosted
      // model family later without renaming config.
      model: optional('GCP_LLM_MODEL', 'gemini-3.1-pro-preview'),
    },
    storage: {
      dataDir: optional('DATA_DIR', '/data/games'),
      // Relative path resolves to CWD: /app/prompts in the Docker image
      // (WORKDIR /app) and ./prompts locally when running `npm run dev`.
      promptsDir: optional('PROMPTS_DIR', './prompts'),
    },
    polling: {
      gameWatcherMs: intEnv('GAME_WATCHER_INTERVAL_MS', 3000, 500),
    },
    audio: {
      sampleRate: intEnv('AUDIO_SAMPLE_RATE', 16000, 8000),
      channels: 1,
      silenceRmsThreshold: floatEnv('SILENCE_RMS_THRESHOLD', 250, 0),
    },
    retry: {
      maxAttempts: intEnv('RETRY_MAX_ATTEMPTS', 3, 1),
      baseDelayMs: intEnv('RETRY_BASE_DELAY_MS', 500, 0),
    },
    correction: {
      enabled: boolEnv('TRANSCRIPT_CORRECTION_ENABLED', true),
    },
  };
}

/** Parse a boolean env var — truthy strings `1/true/yes/on` enable. */
function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  console.warn(`[config] ${name}="${raw}" is not a valid boolean; using default ${fallback}`);
  return fallback;
}
