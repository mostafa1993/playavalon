# Avalon — Video Calling & AI Agent Implementation Plan

## Infrastructure

- **Hosting**: Single VM on Azure or GCP (4 vCPU, 16GB RAM)
- **Deployment**: Docker Compose — LiveKit server + Next.js app + Redis (session/state cache) + AI agent service
- **Domain**: Custom domain with SSL (managed via cloud provider or Cloudflare)
- **Current stack stays**: Next.js 15, Supabase (hosted), Tailwind, TypeScript

---

## Phase 1 — Video Calling (LiveKit)

### Goal
Every player in the lobby and game sees a video grid of all participants. Video enhances the social deduction experience without changing any game logic.

### 1.1 LiveKit Server Setup

#### Local Dev (your laptop)

```bash
docker compose -f docker-compose-dev.yml up
```

Then in a separate terminal:
```bash
npm run dev
```

```yaml
# docker-compose-dev.yml
services:
  livekit:
    image: livekit/livekit-server:latest
    command: --dev
    ports:
      - "7880:7880"
      - "7881:7881"
      - "50000-60000:50000-60000/udp"
```

- `--dev` flag = auto-generated keys, no SSL, no config file needed
- Next.js runs on your host (not in Docker) — hot reload, fast iteration
- Supabase stays remote (your hosted instance) — no change
- Test with multiple browser tabs on `localhost:3000` — each tab is a different player
- On first run, grab the API key/secret from LiveKit's Docker logs:
  ```bash
  docker compose -f docker-compose-dev.yml logs livekit | grep "API"
  ```
- `.env.local` for dev:
  ```
  LIVEKIT_URL=ws://localhost:7880
  LIVEKIT_API_KEY=<from docker logs>
  LIVEKIT_API_SECRET=<from docker logs>
  ```

### 1.2 Token Service (API Route)

**What**: Backend endpoint that generates short-lived LiveKit access tokens for authenticated players.

- New dependency: `livekit-server-sdk` (Node.js)
- New API route: `POST /api/livekit/token`
  - Input: `roomCode`, `playerId`, `playerNickname`
  - Validates that the player belongs to the room (query `room_players`)
  - Generates a JWT token using LiveKit server SDK with grants:
    - `room: roomCode`
    - `roomJoin: true`
    - `canPublish: true`
    - `canSubscribe: true`
  - Returns `{ token: string, wsUrl: string }`
- Token TTL: 6 hours (covers a full game session)
- Watcher tokens: `canPublish: false` (view-only)

### 1.3 Adaptive Resolution Strategy

**What**: Video quality adapts based on participant count.

| Participants | Resolution | Bitrate    | Rationale                              |
|-------------|------------|------------|----------------------------------------|
| 1-4          | 720p       | ~1.2 Mbps  | Larger tiles, worth the quality        |
| 5-10         | 480p       | ~0.5 Mbps  | Tiles are small, 720p is wasted pixels |

- Use LiveKit simulcast: client publishes multiple quality layers, server picks the right one per subscriber
- Configure publish defaults:
  ```typescript
  {
    videoEncoding: {
      maxBitrate: participantCount <= 4 ? 1_200_000 : 500_000,
      maxFramerate: 24,
    },
    simulcast: true,
    resolution: participantCount <= 4
      ? VideoPresets.h720.resolution
      : VideoPresets.h480.resolution,
  }
  ```
- When a 5th player joins, all clients downshift to 480p (triggered via room participant count event)

### 1.4 Frontend — Video Grid Component

**What**: A `<VideoRoom>` component that renders the LiveKit video grid inside the existing game UI.

**New dependencies**:
- `livekit-client` — core WebRTC client
- `@livekit/components-react` — pre-built React components (video tiles, controls)

**Components to build**:

| Component               | Description                                                    |
|-------------------------|----------------------------------------------------------------|
| `VideoRoom.tsx`         | Top-level wrapper — connects to LiveKit room, manages state    |
| `VideoGrid.tsx`         | Responsive grid layout for participant video tiles             |
| `VideoTile.tsx`         | Single participant tile — video or static avatar + name + mute icon |
| `AudioOnlyTile.tsx`     | Fallback tile for no-camera players — initials/avatar + name   |
| `VideoControls.tsx`     | Camera toggle, mic toggle, settings                            |
| `ViewModeToggle.tsx`    | Three-state toggle: Video / Split / Game                       |
| `DeviceSelector.tsx`    | Dropdown to pick camera/mic (before joining)                   |
| `VideoPreJoin.tsx`      | Preview screen — see yourself before entering the room         |
| `ChatPanel.tsx`         | Text chat sidebar (via LiveKit data channels)                  |

**Audio-only players (no camera)**:
- Players who join without a camera (or choose "Join without video") get a static tile:
  ```
  ┌──────────────┐
  │              │
  │     🛡️       │  ← static avatar or initials
  │    Sarah     │
  │   🎤 active  │
  └──────────────┘
  ```
- They still have audio — can talk and hear everyone
- Their tile shows a speaking indicator when their mic is active

**Text chat** (via LiveKit data channels):
- Chat panel alongside the video grid — toggle open/close
- Messages sent via LiveKit data channels (no extra WebSocket needed)
- Shows `nickname: message` with timestamps
- Useful when someone can't use mic, or for side comments during the game
- Unread message badge when chat is collapsed

**LiveKit connection persistence**:
- LiveKit client is initialized in a **layout-level React context provider** (above page components)
- When navigating from `/rooms/[code]` → `/game/[id]`, the connection stays alive — no reconnect blip
- The provider holds the LiveKit `Room` object, video/audio track state, and chat messages
- Pages consume the connection via `useLiveKit()` hook

**Key behaviors**:
- Auto-join LiveKit room when entering the lobby (after camera/mic permission)
- Reconnect automatically on network interruption (LiveKit handles this)
- Show participant name from game state (not LiveKit metadata) for consistency
- Muted-by-default option in settings (some players may prefer to unmute manually)
- Display connection quality indicator per tile
- Desktop only for Phase 1 — mobile layout deferred to Phase 3

### 1.5 Room Manager Moderator Controls

**What**: The room creator (manager) gets extra controls over other players' audio/video.

**Manager sees on each player's video tile**:
```
┌──────────────┐
│   Sarah   🎤 │  ← manager sees a clickable mic icon on every tile
│     🎥       │
│  [🔇] [📷❌] │  ← mute mic / disable camera (only visible to manager)
└──────────────┘
```

**Controls**:
| Action              | What it does                                        |
|---------------------|-----------------------------------------------------|
| Mute player mic     | Server-side mute via LiveKit API — player can't unmute themselves until manager allows |
| Disable player cam  | Turns off their video track                         |
| Mute all            | One button to mute everyone (useful before role reveal, or to get attention) |
| Unmute all          | Release all mutes, everyone can talk again           |

**How it works**:
- LiveKit has built-in participant permissions — the manager's token gets `canPublishData: true` + admin grants
- Manager sends mute/unmute commands via LiveKit's server-side API (`PUT /twirp/livekit.RoomService/MutePublishedTrack`)
- Muted players see a "You've been muted by the host" indicator
- Players can always mute *themselves* — manager controls are about muting *others*

**When it's useful in Avalon**:
- "Everyone shut up, it's voting time" → Mute All
- One person talking over everyone → Mute just them
- Role reveal phase → Mute All so nobody accidentally reacts out loud
- Assassin deliberation → Mute everyone except the evil team

### 1.6 View Mode Toggle

**What**: A three-state toggle that lets players control how much screen space goes to video vs game.

```
[ 🎥 Video ]  [ ⚔️ Split ]  [ 🎮 Game ]
```

| Mode    | Video        | Game Board   | When to use                              |
|---------|-------------|-------------|------------------------------------------|
| Video   | 100%        | Hidden       | Discussion phase, just talking            |
| Split   | 40%         | 60%          | Default — see faces while playing         |
| Game    | Hidden      | 100%         | Low bandwidth, focused gameplay           |

- Audio always stays on regardless of view mode (you hear everyone even in Game mode)
- Chat stays accessible in all modes
- Stored in localStorage so it remembers your preference
- Keyboard shortcut: `V` to cycle through modes
- Default: **Split**

**Desktop layouts**:

Video mode:
```
┌──────────────────────────────────────────┐
│  [ 🎥 Video ]  [ ⚔️ Split ]  [ 🎮 Game ]  │
├──────────────────────────────────────────┤
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │
│  │Sarah │ │ Mike │ │ John │ │  Ali │   │
│  │  🎥  │ │  🎥  │ │  🎥  │ │  🎥  │   │
│  └──────┘ └──────┘ └──────┘ └──────┘   │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │
│  │  You │ │ Reza │ │ Nima │ │ Amir │   │
│  │  🎥  │ │  🎥  │ │  🎥  │ │  🎥  │   │
│  └──────┘ └──────┘ └──────┘ └──────┘   │
├──────────────────────────────────────────┤
│  🎤 Mute  │  📷 Camera  │  ⚙️ Settings   │
└──────────────────────────────────────────┘
```

Split mode (default):
```
┌──────────────────────────────────────────────────────┐
│  [ 🎥 Video ]  [ ⚔️ Split ]  [ 🎮 Game ]              │
├────────────────────────────┬─────────────────────────┤
│                            │ ┌──────┐ ┌──────┐      │
│       GAME BOARD           │ │Sarah │ │ Mike │      │
│                            │ │  🎥  │ │  🎥  │      │
│  Quest 2 - Vote now        │ └──────┘ └──────┘      │
│                            │ ┌──────┐ ┌──────┐      │
│  [ Approve ] [ Reject ]    │ │ John │ │  Ali │      │
│                            │ │  🎥  │ │  🎥  │      │
│                            │ └──────┘ └──────┘      │
├────────────────────────────┴─────────────────────────┤
│  🎤 Mute  │  📷 Camera  │  ⚙️ Settings               │
└──────────────────────────────────────────────────────┘
```

Game mode:
```
┌──────────────────────────────────────────┐
│  [ 🎥 Video ]  [ ⚔️ Split ]  [ 🎮 Game ]  │
├──────────────────────────────────────────┤
│                                          │
│            GAME BOARD                    │
│                                          │
│     Quest 2 - Vote now                   │
│                                          │
│     [ Approve ] [ Reject ]               │
│                                          │
│                                          │
├──────────────────────────────────────────┤
│  🎤 Mute  │  📷 Camera  │  ⚙️ Settings   │
└──────────────────────────────────────────┘
```

### 1.7 Lobby Integration

**What**: Wire video into the existing lobby flow.

- When a player joins a room, fetch a LiveKit token from `/api/livekit/token`
- Show `VideoPreJoin` screen: camera preview + device selection + "Join with video" / "Join without video" buttons
- Store video preference in localStorage (remember for next session)
- `PlayerList` component shows a camera icon next to players who have video on
- Room manager can toggle "video required" vs "video optional" in room settings
- Disconnect from LiveKit room when leaving the game room
- Lobby page defaults to **Video mode** (no game board yet, so full screen video makes sense)

### 1.8 Game Page Integration

**What**: Video grid coexists with the game board during active play.

- LiveKit connection persists across lobby → game page transition (no rejoin, handled by layout provider)
- Default view mode: **Split**
- Video grid tiles show role-relevant indicators (e.g., "Leader" badge on current quest leader)
- During Assassin phase, clicking a video tile could select that player as the Assassin's target (nice UX touch, optional)

### 1.9 VM Deployment (when ready to test with friends / go live)

**What**: Deploy everything to a single Azure/GCP VM with Docker Compose.

This is NOT needed during local development — only set this up when you're ready to test with friends or go live.

#### VM Specs
- 4 vCPU, 16GB RAM (Azure `Standard_B4ms` or GCP `e2-standard-4`)
- Ubuntu 22.04
- Docker + Docker Compose installed

#### Docker Compose (production)

```yaml
# docker-compose.yml
services:
  traefik:
    image: traefik:v3
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.letsencrypt.acme.tlschallenge=true
      - --certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}
      - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - letsencrypt:/letsencrypt

  app:
    build: .
    env_file: .env
    depends_on:
      - livekit
      - redis
    labels:
      - traefik.enable=true
      - traefik.http.routers.app.rule=Host(`${DOMAIN}`)
      - traefik.http.routers.app.tls.certresolver=letsencrypt
      - traefik.http.services.app.loadbalancer.server.port=3000

  livekit:
    image: livekit/livekit-server:latest
    ports:
      - "7881:7881"
      - "50000-60000:50000-60000/udp"
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml
    command: --config /etc/livekit.yaml
    labels:
      - traefik.enable=true
      - traefik.http.routers.livekit.rule=Host(`livekit.${DOMAIN}`)
      - traefik.http.routers.livekit.tls.certresolver=letsencrypt
      - traefik.http.services.livekit.loadbalancer.server.port=7880

  redis:
    image: redis:7-alpine

volumes:
  letsencrypt:
```

- Traefik auto-discovers services via Docker labels — no separate config files for routing
- SSL certificates auto-provisioned via Let's Encrypt
- All routing defined inline on each service: `DOMAIN` and `livekit.DOMAIN`
- Redis not exposed to host — only accessible within the Docker network

#### LiveKit Config (`livekit.yaml`)
```yaml
port: 7880
rtc:
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
keys:
  <your_api_key>: <your_api_secret>
```

#### Environment (`.env` on VM)
```
DOMAIN=yourdomain.com
ACME_EMAIL=you@email.com
LIVEKIT_URL=wss://livekit.yourdomain.com
LIVEKIT_API_KEY=<your_key>
LIVEKIT_API_SECRET=<your_secret>
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

#### VM Firewall
- 80, 443 (HTTP/HTTPS — Traefik)
- 7881 (LiveKit TURN/TCP fallback)
- 50000-60000/UDP (WebRTC media)

#### Dockerfile (Next.js app)
- Multi-stage build: `npm install` → `npm run build` → production image with `npm start`

#### CI/CD (simple)
- Push to `main` → GitHub Actions → SSH into VM → `git pull && docker compose up --build -d`
- Or: build image → push to GitHub Container Registry → VM pulls and restarts

#### Migration from Vercel
- The app currently deploys to Vercel. With LiveKit needing a persistent server, the VM replaces Vercel.
- Keep Supabase as the hosted database — no change.
- Optionally keep Vercel deployment as a staging environment (game logic only, no video).

---

## Phase 2 — AI Agent Player (Turn-Based, Persian)

### Goal
An AI agent that joins the game as a real player. It listens to each player's speech turn-by-turn, preprocesses each utterance in advance, and when it's the AI's turn, generates a strategic response and speaks it via TTS. The game is played in **Persian (Farsi)**.

### 2.1 Architecture Overview — Turn-Based Pipeline

```
  Player 1 turn (50s)              Player 2 turn (50s)              AI's turn
  ┌──────────────┐                 ┌──────────────┐                 ┌──────────────────────┐
  │ Record audio │                 │ Record audio │                 │ Collect all           │
  │ from LiveKit │                 │ from LiveKit │                 │ preprocessed summaries│
  │ audio track  │                 │ audio track  │                 │ + game state + role   │
  └──────┬───────┘                 └──────┬───────┘                 └──────────┬───────────┘
         │                                │                                    │
         ▼                                ▼                                    ▼
  ┌──────────────┐                 ┌──────────────┐                 ┌──────────────────────┐
  │ Whisper STT  │                 │ Whisper STT  │                 │ LLM (Claude/GPT-4)   │
  │ (full audio) │                 │ (full audio) │                 │ Generate response     │
  └──────┬───────┘                 └──────┬───────┘                 │ in Persian            │
         │                                │                         └──────────┬───────────┘
         ▼                                ▼                                    │
  ┌──────────────┐                 ┌──────────────┐                            ▼
  │ LLM preproc  │                 │ LLM preproc  │                 ┌──────────────────────┐
  │ - Summary    │                 │ - Summary    │                 │ Azure TTS (fa-IR)    │
  │ - Sentiment  │                 │ - Sentiment  │                 │ Generate Persian      │
  │ - Key claims │                 │ - Key claims │                 │ speech audio          │
  │ - Accusations│                 │ - Accusations│                 └──────────┬───────────┘
  └──────┬───────┘                 └──────┬───────┘                            │
         │                                │                                    ▼
         ▼                                ▼                         ┌──────────────────────┐
  ┌──────────────────────────────────────────────┐                  │ Publish audio to     │
  │        Preprocessed Context Store            │                  │ LiveKit room          │
  │  (ready before AI's turn — zero wait)        │                  │ (AI "speaks")         │
  └──────────────────────────────────────────────┘                  └──────────────────────┘
```

**Key design principle**: preprocessing happens in parallel with other players' turns, so when the AI's turn comes, all context is already prepared. The AI responds in ~1-2 seconds instead of ~10+ seconds.

### 2.2 AI Agent Service

**What**: A Node.js service (same language as the app, shared types) that runs alongside the app.

**Why Node.js (not Python)**:
- Same language as the app — shared types, shared API client code
- Turn-based approach doesn't need Python's audio ML ecosystem
- Audio recording from LiveKit → file → Whisper API is simple in Node
- Simpler deployment (one language stack)

**Service responsibilities**:
1. Join LiveKit room as a participant
2. Record each speaker's audio during their speaking timer turn
3. After each turn: send audio to Whisper STT → get text
4. After each turn: send text to LLM for preprocessing (summary, sentiment, key claims)
5. When AI's turn: collect all preprocessed data → LLM generates response → TTS → play audio
6. Submit game actions (votes, quest cards, team proposals) via the app's API routes

**Docker Compose addition**:
```yaml
ai-agent:
  build: ./ai-agent
  env_file: .env
  depends_on:
    - livekit
    - app
  volumes:
    - ai_audio:/tmp/audio  # Temporary audio recordings
```

### 2.3 Audio Recording (Per Turn)

**What**: Record each player's audio during their speaking timer turn.

- Agent subscribes to all human audio tracks in the LiveKit room
- When a player's speaking timer starts, begin recording their audio track
- When their timer ends (or they're auto-muted), stop recording
- Save as WAV/WebM file in temp storage
- Speaker identity is automatic — each LiveKit track belongs to a known player

**Not continuous streaming** — only record during active speaking turns. This saves:
- STT costs (only transcribe ~50s per player per quest, not hours)
- Processing resources
- Storage

### 2.4 Speech-to-Text (Whisper)

**What**: Transcribe each player's recorded audio after their turn ends.

- Use **OpenAI Whisper API** — best Persian (Farsi) support
- Send the full audio file (not streaming) — better accuracy for Persian
- Returns complete text with punctuation
- One API call per player turn (~50s of audio)
- Cost: ~$0.006 per minute → ~$0.005 per turn → ~$0.25 per full game

**Why Whisper over Azure STT**:
- Superior Persian transcription accuracy
- Simpler API (upload file, get text)
- No streaming session management needed (turn-based approach)

### 2.5 LLM Preprocessing (Pipelined)

**What**: After each player's turn is transcribed, immediately send to LLM for analysis. This runs in parallel with the next player's turn.

**Preprocessing prompt** (runs after each player speaks):
```
You are analyzing a player's speech in an Avalon board game (spoken in Persian).

Player: {seat_number} - {player_name}
Quest: {current_quest}
Phase: {phase}
Raw transcript: "{transcribed_text}"

Analyze and output JSON:
{
  "summary": "1-2 sentence summary of what they said",
  "sentiment": "confident/defensive/accusatory/neutral/nervous",
  "key_claims": ["claims they made about themselves or others"],
  "accusations": ["who they accused and of what"],
  "contradictions": ["anything that contradicts their previous statements"],
  "trust_signals": "high/medium/low — how trustworthy they sound"
}
```

**Use a fast/cheap model** for preprocessing (Claude Haiku or GPT-4o-mini):
- ~500 tokens in, ~200 tokens out per call
- Cost: ~$0.001 per preprocessing
- Latency: ~500ms — finishes well before next player's turn ends

**Result**: by the time it's the AI's turn, it has structured analysis of every player's speech, not just raw text.

### 2.6 Game Memory System

**What**: The AI maintains a persistent mental model of each player throughout the game — like how a real player remembers behavior patterns, contradictions, and alliances across quests.

**Structure** (files stored in temp storage or AI Postgres, one set per game):

```
/game-memory/{gameId}/
  player-1-sarah.md      ← updated after every turn Sarah speaks
  player-2-mike.md       ← updated after every turn Mike speaks
  player-3-john.md       ← ...
  game-overview.md       ← quest results, vote patterns, team history
  my-strategy.md         ← AI's own suspicions, plans, role-specific notes
```

**Player memory file** (updated after each of their speaking turns):

```markdown
# Player 1 — Sarah (Seat 1)

## Trust Level: Medium → Low (updated Quest 3)

## Quest 1 — Discussion
- Proposed a safe team, seemed cautious
- Defended Mike when accused

## Quest 2 — Discussion
- Changed stance on Mike, now suspicious of him
- Contradicted Quest 1 defense — possible evil distancing

## Quest 3 — Discussion
- Accused AI directly — could be deflecting
- Vote pattern: approved every team with Player 4

## Observations
- Always agrees with Player 4 → possible evil pair
- Gets defensive when questioned about Quest 2 fail
- Claimed to be Percival in Quest 3 but no evidence
```

**AI strategy file** (updated after each preprocessing + before each response):

```markdown
# AI Strategy — Role: Merlin

## Known Evil Players
- Player 4 (confirmed — visible to me)
- Player 2 (confirmed — visible to me)

## Suspicions from Discussion
- Sarah and Player 4 vote together → likely allied
- Mike seems genuinely confused → likely good

## My Plan
- Hint at Player 4 being evil without being obvious
- Support Mike's accusations to guide the team
- Avoid direct accusations — Assassin is watching
```

**Game overview file** (updated after each quest):

```markdown
# Game Overview

## Quest Results
- Quest 1: SUCCESS (team: Sarah, Mike) — 0 fails
- Quest 2: FAIL (team: Sarah, Player 4, John) — 1 fail
- Quest 3: in progress

## Vote Patterns
- Player 4 rejects every team without themselves
- Sarah approves everything Player 4 approves

## Team Proposal History
- Quest 1: Sarah proposed [Sarah, Mike] — approved 4-1
- Quest 2: Player 4 proposed [Sarah, Player 4, John] — approved 3-2
```

**How memory is updated**:

After each player speaks:
1. STT transcribes their speech
2. LLM preprocessing summarizes + analyzes
3. **Memory update call** (cheap model): takes the new analysis + existing player memory file → outputs updated file
4. Updated file is written back

Before AI's turn:
1. **Strategy update call**: takes all player memory files + game overview → updates `my-strategy.md`
2. Final response generation reads `my-strategy.md` + relevant player files as context

**Why files/markdown (not structured DB)**:
- LLMs work best with natural language context, not SQL queries
- Easy to include entire file in prompt context
- Human-readable for debugging and post-game review
- Can be stored in AI Postgres as text columns if preferred

**Memory budget**: each player file ~500-1000 tokens after a full game. With 10 players + overview + strategy = ~8-12k tokens total. Well within context limits.

### 2.7 AI Response Generation

**What**: When it's the AI's turn, generate a strategic response using all preprocessed context.

**Context assembled for the final LLM call**:
```
System prompt (Persian):
  - You are playing Avalon. Your role is {role}. Speak in Persian.
  - Game rules summary (in Persian)
  - Your role's abilities and constraints
  - Personality: {personality_profile}
  - IMPORTANT: You must sound natural, like a real Persian speaker. Use informal
    conversational Persian, not formal/literary.

Game memory (loaded from files):
  - my-strategy.md: {AI's current suspicions, plans, known info}
  - game-overview.md: {quest results, vote patterns, team history}
  - Player files: {trust levels, observations, contradictions for each player}

Current quest context:
  Player 1 (Sarah): {this turn's summary, sentiment, key_claims}
  Player 2 (Mike): {this turn's summary, sentiment, key_claims}
  ...

Your task: Generate your spoken response for this discussion round.
Think strategically based on your role and memory. Keep it 2-4 sentences.
```

**Use the best model** for the final response (Claude Opus or GPT-4):
- Needs strong Persian language generation
- Needs strategic reasoning (bluffing, deduction)
- ~5-10k tokens in (including memory files), ~100-200 tokens out
- Latency: ~1-2s (memory is pre-loaded, not computed on the fly)

**Decision types**:
| Phase            | AI Decision                          | Output                  |
|-----------------|--------------------------------------|-------------------------|
| Discussion       | What to say (Persian speech)         | Persian text → TTS      |
| Team building    | Propose team (if leader)             | Team + explanation      |
| Voting           | Approve or reject                    | Vote + spoken reason    |
| Quest execution  | Success or fail                      | Quest action            |
| Assassin phase   | Who is Merlin (if Assassin)          | Player name + reason    |
| Merlin Quiz      | Who do you think is Merlin           | Player name             |

### 2.7 Text-to-Speech (Persian)

**What**: Convert the AI's Persian text response into natural speech.

- **Primary: Azure TTS** — `fa-IR-DilaraNeural` or `fa-IR-FaridNeural` (Persian neural voices)
- **Alternative: ElevenLabs** — supports Persian, more natural sounding but more expensive
- Generate audio as PCM/Opus → publish to LiveKit room's audio track
- Latency: ~300-500ms for first audio chunk

### 2.8 Simple Animated Avatar

**What**: A minimal visual presence in the video grid.

**Canvas-based avatar** (server-side, `node-canvas`):
- Static character illustration as base
- Mouth animation synced to TTS audio amplitude when speaking
- State indicators: idle / listening / thinking / speaking
- Published as a video track to LiveKit

| State     | Visual                                         |
|-----------|-------------------------------------------------|
| Idle      | Static character, subtle breathing animation    |
| Listening | Ear glow or "..." bubble                        |
| Thinking  | Dots animation (when LLM is generating)         |
| Speaking  | Mouth animation synced to audio                 |

### 2.9 Game Integration

**What**: AI agent interacts with the game through existing API routes — treated as a regular player.

**Joining a game**:
1. Room manager toggles "Add AI Player" in lobby
2. App creates a player record for the AI
3. App calls agent service: `POST /agent/join { roomCode, playerId }`
4. Agent connects to LiveKit room
5. Agent appears in player list and video grid

**Integration with speaking timer**:
- Agent listens for speaking timer data channel messages
- Knows when each player's turn starts/ends → triggers recording
- Knows when its own turn starts → triggers response generation
- After generating response + TTS, the audio plays during its timer window

**Acting in the game**:
- Agent subscribes to game state via Supabase Realtime
- Automatically submits votes, quest actions, team proposals via API
- Speaks its reasoning via TTS during discussion phases

### 2.10 AI Personality & Strategy Profiles

**What**: Configurable personality (in Persian).

- **محتاط (Cautious)**: Plays safe, doesn't accuse unless strong evidence
- **تهاجمی (Aggressive)**: Accuses early, takes risks, bluffs confidently
- **تحلیلگر (Analytical)**: Focuses on vote patterns, speaks methodically
- **پیش‌فرض (Default)**: Balanced mix, adapts based on role

Room manager picks a personality when adding the AI player.

### 2.11 Latency Budget (Turn-Based)

| Step                              | Time    | When it happens                          |
|-----------------------------------|---------|------------------------------------------|
| Record player audio               | 50s     | During their speaking turn               |
| Whisper STT                       | ~3-5s   | After their turn ends (in parallel)      |
| LLM preprocessing                 | ~0.5-1s | After STT (in parallel with next player) |
| **All preprocessing done before AI's turn** | **0s** | **Already completed** |
| LLM response generation           | ~1-2s   | When AI's turn starts                    |
| TTS audio generation              | ~0.5s   | After LLM response                      |
| **Total delay when AI starts speaking** | **~1.5-2.5s** | **Feels like natural thinking** |

### 2.12 Data Storage (Self-Hosted Postgres)

**What**: Separate Postgres database for AI data (game data stays on Supabase).

```yaml
ai-db:
  image: postgres:16-alpine
  environment:
    POSTGRES_DB: avalon_ai
    POSTGRES_PASSWORD: ${AI_DB_PASSWORD}
  volumes:
    - ai_data:/var/lib/postgresql/data
```

Stores:
- Transcripts per game session (raw + preprocessed)
- AI reasoning logs (what it decided and why)
- Performance metrics (how often AI won, accuracy of reads)
- Post-game review data

### 2.13 Cost Estimate (Per Game Session, ~3-4 Hours)

| Service                          | Usage                              | Cost         |
|----------------------------------|------------------------------------|--------------|
| Whisper STT                      | ~50 turns × 50s = ~42 min          | ~$0.25       |
| LLM preprocessing (Haiku/mini)   | ~50 calls × ~700 tokens            | ~$0.10       |
| LLM response (Claude/GPT-4)     | ~10 calls × ~3k tokens             | ~$1-2        |
| Azure TTS (Persian)              | ~10 responses × ~50 words          | ~$0.10       |
| **Total per session**            |                                    | **~$1.50-2.50** |

Much cheaper than the original estimate ($6-8) because:
- Turn-based STT (not continuous) — 90% less audio to transcribe
- Preprocessing with cheap models — saves on expensive model tokens
- Fewer LLM calls — only when AI speaks, not continuous listening

---

## Phase 3 — Polish & Platform Support

### Goal
Optimization, mobile support, and quality-of-life features that aren't needed to launch but make the experience better.

### 3.1 Seat Numbers on Video Tiles

**What**: When the game starts, each player gets a seat number (based on seating order / first leader). This number shows on their video tile.

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  1 - Sarah   │  │  2 - Mike    │  │  3 - John    │
│     🎥       │  │     🎥       │  │     🎥       │
└──────────────┘  └──────────────┘  └──────────────┘
```

- Number assigned from the game's `seating_order` (already exists in the DB)
- Makes it easy to say "Player 3 is sus" instead of fumbling with names
- Number persists for the whole game, doesn't change between quests
- Shows in lobby (no number) → game starts → numbers appear

### 3.2 Mobile Layout & Responsive Video

**What**: Proper mobile browser support for video calling.

- Video strip (swipeable horizontal scroll) above game board
- Tap strip to expand to full gallery view, tap again to collapse
- Three-state toggle adapted for mobile (compact icons)
- Touch-friendly video controls
- Test on Safari iOS + Chrome Android
- Handle mobile-specific WebRTC quirks (Safari autoplay policies, background tab throttling)

### 3.3 Screen Sharing

**What**: Allow a player to share their screen in the video grid.

- Replaces their video tile with screen content
- Useful for showing something to the group
- LiveKit supports this natively

### 3.4 Random Speaking Order Indicator

**What**: At each discussion turn, display a randomly selected seat number at the top of the game board to indicate who starts talking.

- Random number (from the active player seat numbers) shown prominently at the top of the game area
- Changes each turn/quest to keep discussion order fresh
- Prevents the same person from always leading the conversation
- Just a suggestion — not enforced, but gives structure to discussion

### 3.5 Rejoin Video After Disconnect

**What**: If a player clicks the end call button (or loses connection) during a game, they should be able to rejoin the video call.

- After disconnecting, show the "Join with video" / "Join audio only" buttons again on the game page
- Rejoin should reconnect to the same LiveKit room seamlessly
- Other participants see the player leave and reappear in the video grid
- Audio/video preferences (camera on/off) should be remembered from before disconnect

### 3.5 Game Session Recording

**What**: Record the full game session (audio + video + game events) for post-game review.

- LiveKit Egress service for recording
- Save to cloud storage (Azure Blob / GCS)
- Post-game: replay the session with game events overlaid

---

## Feature Summary by Spec Number

Continuing the existing spec numbering:

| Spec  | Feature                          | Phase | Priority |
|-------|----------------------------------|-------|----------|
| 021   | LiveKit server setup + Docker    | 1     | P0       |
| 022   | Token service API route          | 1     | P0       |
| 023   | Video grid + audio-only tiles    | 1     | P0       |
| 024   | LiveKit layout provider          | 1     | P0       |
| 025   | Lobby video integration          | 1     | P0       |
| 026   | Game page video layout           | 1     | P0       |
| 027   | View mode toggle                 | 1     | P1       |
| 028   | Text chat (data channels)        | 1     | P1       |
| 029   | Manager moderator controls       | 1     | P1       |
| 030   | Adaptive resolution (720p/480p)  | 1     | P1       |
| 031   | Watcher video (view-only)        | 1     | P2       |
| 032   | VM deployment + Docker Compose   | 1     | P0       |
| 033   | AI agent service scaffold (Node) | 2     | P0       |
| 034   | Audio recording per turn         | 2     | P0       |
| 035   | Whisper STT integration          | 2     | P0       |
| 036   | LLM preprocessing pipeline       | 2     | P0       |
| 037   | Game memory system (per-player)  | 2     | P0       |
| 038   | AI response generation (Persian) | 2     | P0       |
| 039   | Azure TTS Persian voice          | 2     | P0       |
| 040   | AI game integration (API actions)| 2     | P0       |
| 041   | Simple animated avatar           | 2     | P1       |
| 042   | AI personality profiles (Persian)| 2     | P2       |
| 043   | AI Postgres database             | 2     | P1       |
| 041   | Mobile layout + responsive video | 3     | P1       |
| 042   | Seat numbers on video tiles      | 3     | P0       |
| 044   | Random speaking order indicator  | 3     | P1       |
| 045   | Rejoin video after disconnect    | 3     | P0       |
| 046   | Screen sharing                   | 3     | P2       |
| 047   | Game session recording           | 3     | P2       |

---

## Cost Estimate (Per Game Session, ~3-4 Hours)

| Service                          | Usage                              | Cost         |
|----------------------------------|------------------------------------|--------------|
| VM (4 vCPU, 16GB, game-only)     | ~4 hours                           | ~$0.50       |
| Whisper STT                      | ~50 turns × 50s = ~42 min          | ~$0.25       |
| LLM preprocessing (Haiku/mini)   | ~50 calls × ~700 tokens            | ~$0.10       |
| LLM response (Claude/GPT-4)     | ~10 calls × ~3k tokens             | ~$1-2        |
| Azure TTS (Persian)              | ~10 responses × ~50 words          | ~$0.10       |
| **Total per session**            |                                    | **~$2-3**    |

If the VM runs 24/7: add ~$50-100/month. Consider auto-start/stop scripts if playing weekly.

---

## Decisions Made

- **Game state**: stays on Supabase Realtime. LiveKit data channels used only for text chat.
- **Video resolution**: 720p for ≤4 players, 480p for 5+ (automatic via simulcast)
- **No camera players**: join with audio only, shown as static avatar tile with name
- **Text chat**: yes, via LiveKit data channels
- **Mobile**: deferred to Phase 3
- **LiveKit connection**: persists across page transitions via layout-level provider
- **Local dev**: `docker-compose-dev.yml` (LiveKit only) + `npm run dev` on host
- **Production**: `docker-compose.yml` with Traefik for routing + auto-SSL
- **Seat numbers on video tiles**: Phase 3 — assigned from seating order when game starts
- **AI database**: separate self-hosted Postgres for AI data (transcripts, reasoning logs). Game data stays on Supabase.

## Open Questions

1. **AI agent language**: Node.js (same as app, shared types) or Python (better ML/audio ecosystem)? Recommendation: Node.js for simplicity, unless audio processing needs dictate Python.
2. **Multiple AI agents**: Support more than one AI player per game? Start with one, design the service to handle multiple.
3. **Voice selection**: Let the room manager pick the AI's voice? Nice-to-have for Phase 2.
4. **Post-game transcript**: Save the full labeled transcript for post-game review? Cheap to store, fun to read back.
