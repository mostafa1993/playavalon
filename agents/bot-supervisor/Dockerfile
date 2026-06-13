# Playavalon bot players (supervisor + spawned agents).
# BUILD CONTEXT = agents/ (the workspace root) — the image needs the
# @avalon/shared workspace package (LLM client for `mode: smart`). Compose:
#   build: { context: ./agents, dockerfile: bot-supervisor/Dockerfile }
#
# The supervisor watches the rooms table and spawns one agent process per bot
# seat via cli/run.ts. Configs are NOT baked in — mounted at /app/configs.
# Runtime: tsx (no precompile for the bot's own source; shared/ is prebuilt).
#
# Env at runtime: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
# NEXT_PUBLIC_SUPABASE_ANON_KEY, AGENT_BASE_URL, AGENTS_CONFIGS_DIR;
# smart mode also: GCP_PROJECT_ID (+ GOOGLE_APPLICATION_CREDENTIALS secret).

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY reviewer/package.json reviewer/
COPY bot-supervisor/package.json bot-supervisor/
# Full install (tsx is a devDependency and IS the runtime here). NOTE: do NOT
# --omit=optional — @livekit/rtc-node's native platform binding (pulled in via
# @avalon/shared) is an optionalDependency and the import dies without it.
RUN npm ci
COPY shared/tsconfig.json shared/
COPY shared/src shared/src
RUN npm run build -w @avalon/shared

FROM node:22-slim AS runner
# Replicate the workspace layout: node_modules/@avalon/shared symlinks to
# ../../shared, so shared/{package.json,dist} sits beside node_modules.
WORKDIR /app/bot-supervisor
COPY --from=deps /app/node_modules /app/node_modules
COPY shared/package.json /app/shared/package.json
COPY --from=deps /app/shared/dist /app/shared/dist
COPY bot-supervisor/package.json bot-supervisor/tsconfig.json ./
COPY bot-supervisor/src ./src
COPY bot-supervisor/prompts ./prompts
# configs/ is mounted as a volume at runtime — don't bake them in.

CMD ["npx", "tsx", "src/supervisor/index.ts"]
