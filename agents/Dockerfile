# Dockerfile for the rule-based agentic players workspace.
#
# Produces an image whose default command runs the bot supervisor
# (agents/src/supervisor/index.ts). The supervisor watches the rooms
# table and spawns one agent process per bot seat via cli/run.ts.
#
# Configs are NOT baked in — they're mounted from the host (or another
# volume) at /app/configs so users can edit YAMLs without rebuilding.
#
# Env vars expected at runtime:
#   NEXT_PUBLIC_SUPABASE_URL
#   SUPABASE_SERVICE_ROLE_KEY  (supervisor uses service role to read rooms)
#   NEXT_PUBLIC_SUPABASE_ANON_KEY  (spawned agents use anon for sign-in)
#   AGENTS_ENV_FILE   optional, default /run/secrets/agents.env if not provided
#   AGENTS_CONFIGS_DIR  optional, default /app/configs
#   SUPERVISOR_POLL_MS  optional, default 5000

FROM node:20-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=optional

FROM node:20-slim AS runner
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
# configs/ is mounted as a volume at runtime — don't bake them in.

# tsx as the runtime; no precompile step. Logs go to stdout/stderr.
CMD ["npx", "tsx", "src/supervisor/index.ts"]
