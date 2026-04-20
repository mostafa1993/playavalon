# Playavalon AI reviewer agent.
# Uses node:20-slim (Debian-based) rather than alpine so native modules
# in @livekit/rtc-node (Rust WebRTC bindings) link cleanly.

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
COPY prompts ./prompts

CMD ["node", "dist/index.js"]
