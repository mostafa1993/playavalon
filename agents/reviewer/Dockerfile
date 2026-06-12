# Playavalon AI reviewer agent.
# BUILD CONTEXT = agents/ (the workspace root), NOT agents/reviewer/ — the image
# needs the @avalon/shared workspace package. Compose builds it as:
#   build: { context: ./agents, dockerfile: reviewer/Dockerfile }
# Uses node:20-slim (Debian-based) rather than alpine so native modules
# in @livekit/rtc-node (Rust WebRTC bindings) link cleanly.

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY reviewer/package.json reviewer/
RUN npm ci --omit=dev

FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY reviewer/package.json reviewer/
RUN npm ci
COPY shared/tsconfig.json shared/
COPY shared/src shared/src
COPY reviewer/tsconfig.json reviewer/
COPY reviewer/src reviewer/src
RUN npm run build -w @avalon/shared && npm run build -w playavalon-agent

FROM node:20-slim AS runner
# Replicate the workspace layout: node_modules/@avalon/shared is a symlink to
# ../../shared, so shared/{package.json,dist} must sit beside node_modules.
WORKDIR /app/reviewer
ENV NODE_ENV=production
COPY --from=deps /app/node_modules /app/node_modules
COPY shared/package.json /app/shared/package.json
COPY --from=builder /app/shared/dist /app/shared/dist
COPY --from=builder /app/reviewer/dist ./dist
COPY reviewer/package.json ./
COPY reviewer/prompts ./prompts
COPY reviewer/scripts ./scripts

CMD ["node", "dist/index.js"]
