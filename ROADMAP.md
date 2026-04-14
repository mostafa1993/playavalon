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

## Phase 2 — AI Agent Player

### Goal
An AI agent that joins the game as a real player — it listens to other players speak, reasons about the game, and talks back with a voice and a simple avatar in the video grid.

### 2.1 Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    LiveKit Room                      │
│                                                      │
│  Human Players ◄──── video/audio ────► AI Agent      │
│                                                      │
│  AI Agent publishes:                                 │
│    - Audio track (TTS output)                        │
│    - Video track (animated avatar)                   │
│                                                      │
│  AI Agent subscribes to:                             │
│    - All human audio tracks (for STT)                │
│    - No video tracks (doesn't need to see faces)     │
└──────────────┬──────────────────────┬────────────────┘
               │                      │
               ▼                      ▼
      Azure Speech-to-Text    Game State (Supabase)
               │                      │
               ▼                      │
         ┌─────────┐                  │
         │   LLM   │◄────────────────┘
         │ (Claude) │   context: transcript + game state + role
         └────┬────┘
              │
              ▼
      Azure Text-to-Speech
              │
              ▼
       Audio published to
        LiveKit room
```

### 2.2 AI Agent Service

**What**: A standalone service (Node.js or Python) that runs alongside the app and joins LiveKit rooms as a participant.

**Why a separate service**:
- Long-running process (stays connected for hours)
- CPU/memory for audio processing
- Independent scaling and restart from the web app

**Service responsibilities**:
1. Receive a command to join a specific game room (via API call from the app)
2. Connect to LiveKit room as a participant named "AI Agent" (or a fun name)
3. Subscribe to all human audio tracks
4. Pipe audio to Azure STT for transcription
5. Maintain a running transcript with speaker labels
6. When it's the AI's turn (or during discussion), send context to the LLM
7. Convert LLM response to speech via Azure TTS
8. Publish audio + avatar video to the LiveKit room
9. Submit game actions (votes, quest cards, team proposals) via the app's API routes

**Docker Compose addition**:
```yaml
ai-agent:
  build: ./ai-agent
  env_file: .env
  depends_on:
    - livekit
    - app
```

### 2.3 Speech-to-Text Pipeline

**What**: Transcribe human speech in real-time with speaker labels.

- Use **Azure Speech-to-Text** (real-time streaming API)
- Each player's LiveKit audio track is a separate stream → automatic speaker identification (no diarization needed)
- The agent subscribes to each participant's audio track individually
- For each track: pipe raw audio → Azure STT streaming session → get transcription events
- Build a labeled transcript:
  ```
  [Quest 2 | Discussion]
  Sarah: "I think we should put Mike on this quest"
  Mike: "No way, I failed the last one... wait, I mean I didn't fail it"
  John: "That's exactly what someone who failed it would say"
  ```
- Store transcript in memory (per game session), optionally persist to Redis or Supabase for post-game review
- Only transcribe during active discussion phases (mute STT during voting/quest execution to save cost)

### 2.4 LLM Reasoning Engine

**What**: The brain — takes game context and decides what to say/do.

**LLM choice**: Claude (via Anthropic API) or GPT-4 (via Azure AI Foundry). Claude recommended for its instruction-following and roleplay capabilities.

**Context window per request**:
```
System prompt:
  - You are playing Avalon as [role]. Your secret alignment is [good/evil].
  - Game rules summary (condensed)
  - Your role's special abilities and constraints
  - Behavioral guidelines (don't be obviously AI, maintain persona)

Game state:
  - Current quest number, past quest results
  - Team proposal history and vote patterns
  - Your known information (who you see as evil if Merlin, etc.)
  - Current phase, whose turn it is

Transcript:
  - Full labeled discussion from this game (trimmed to last N rounds if too long)

Task:
  - "It's discussion time. What do you say?" → response text
  - "Propose a team of 3." → team selection + reasoning
  - "Vote approve or reject." → vote + reasoning
  - "Submit quest action (success/fail)." → action + reasoning
```

**Decision types**:
| Phase            | AI Decision                          | Output                  |
|-----------------|--------------------------------------|-------------------------|
| Discussion       | What to say                          | Spoken text             |
| Team building    | Propose team (if leader)             | List of player names    |
| Voting           | Approve or reject                    | Vote + optional comment |
| Quest execution  | Success or fail                      | Quest action            |
| Assassin phase   | Who is Merlin (if Assassin)          | Player name             |
| Lady of the Lake | Who to investigate (if holding Lady) | Player name             |
| Merlin Quiz      | Who do you think is Merlin           | Player name             |

**Token management**:
- Keep a rolling context window — full transcript for current quest, summarized for earlier quests
- Estimate ~500-1000 tokens per discussion round, ~10-15 rounds per game → 5k-15k transcript tokens
- Total context per LLM call: ~3-5k (system + game state) + 5-15k (transcript) = ~8-20k tokens
- Use prompt caching (system prompt + game rules are static across calls)

### 2.5 Text-to-Speech

**What**: Convert the LLM's text response into natural speech audio.

- Use **Azure Text-to-Speech** (Neural voices)
- Pick a distinct voice that's clearly "the AI" but still pleasant (e.g., `en-US-GuyNeural` or `en-US-AriaNeural`)
- Generate audio as raw PCM or Opus (compatible with LiveKit audio track)
- Stream the TTS output directly into the LiveKit room's audio track
- Typical latency: 200-500ms for the first audio chunk (streaming mode)

### 2.6 Simple Animated Avatar

**What**: A minimal visual presence in the video grid — not a realistic face, just enough to feel like a participant.

**Approach: Canvas-based animated avatar** (simplest that works)

- A `<canvas>` element (or server-side canvas via `node-canvas`) that renders:
  - A character illustration or icon (static image as the base)
  - Simple mouth animation when speaking (open/close synced to audio amplitude)
  - Name label overlay
  - Optional: subtle idle animation (slight movement, blinking) so it doesn't look frozen
- The canvas output is captured as a video track and published to LiveKit
- This runs inside the AI agent service (headless, using `node-canvas` or `puppeteer` for rendering)

**Why not Azure Talking Avatar**:
- Adds complexity, cost, and another Azure dependency
- A simple animated character fits the board game vibe better than a realistic human face
- Can always upgrade later

**Avatar states**:
| State     | Visual                                         |
|-----------|-------------------------------------------------|
| Idle      | Static character with subtle breathing animation |
| Listening | Small indicator (e.g., ear glow or "..." bubble) |
| Thinking  | Thinking animation (dots, gears, etc.)           |
| Speaking  | Mouth animation synced to audio amplitude        |

### 2.7 Game Integration

**What**: The AI agent interacts with the game through the existing API routes — it's treated as a regular player.

**Joining a game**:
1. Room manager toggles "Add AI Player" in lobby settings
2. App creates a player record for the AI agent (like any other player)
3. App calls the AI agent service: `POST /agent/join { roomCode, playerId, role }`
4. Agent connects to LiveKit room + starts listening
5. Agent appears in the player list and video grid like everyone else

**Acting in the game**:
- Agent polls or subscribes to game state changes (via Supabase Realtime or app webhooks)
- When the game phase changes and it's the AI's turn, the agent:
  1. Queries current game state from the API
  2. Sends context to the LLM
  3. Gets a decision + spoken response
  4. Submits the game action via the API (e.g., `POST /api/games/{id}/vote`)
  5. Speaks the response via TTS → LiveKit audio track

**Discussion participation**:
- During open discussion, the AI listens to the full conversation
- It speaks when there's a natural pause (silence detection: ~3 seconds of no one talking)
- It limits itself to 1-2 comments per discussion round (avoids dominating the conversation)
- It can be "asked a question" — if someone says the AI's name, it responds next

### 2.8 AI Personality & Strategy Profiles

**What**: Configurable personality to make the AI fun to play with.

- **Cautious**: Plays safe, doesn't accuse unless strong evidence, proposes "safe" teams
- **Aggressive**: Accuses early, takes risks, bluffs confidently as evil
- **Analytical**: Focuses on vote patterns and statistics, speaks methodically
- **Default**: Balanced mix, adapts based on role

The room manager picks a personality when adding the AI player (or it's random).

### 2.9 Latency Budget

| Step                              | Target   | Notes                                    |
|-----------------------------------|----------|------------------------------------------|
| Silence detection (end of speech) | ~1-2s    | Wait for natural pause                   |
| STT finalization                  | ~300ms   | Last audio chunk → final transcript      |
| LLM reasoning                    | ~1-3s    | Depends on model and response length     |
| TTS first audio chunk            | ~300ms   | Streaming mode                           |
| **Total (turn to start speaking)** | **~2-5s** | Feels like natural thinking time        |

This latency is fine — in a board game, 2-5 seconds of "thinking" before speaking is completely natural. Faster would actually feel uncanny.

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

### 3.4 Rejoin Video After Disconnect

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
| 033   | AI agent service scaffold        | 2     | P0       |
| 034   | STT pipeline (Azure)             | 2     | P0       |
| 035   | LLM reasoning engine             | 2     | P0       |
| 036   | TTS pipeline (Azure)             | 2     | P0       |
| 037   | Simple animated avatar           | 2     | P1       |
| 038   | AI game integration (API actions)| 2     | P0       |
| 039   | AI discussion participation      | 2     | P1       |
| 040   | AI personality profiles          | 2     | P2       |
| 041   | Mobile layout + responsive video | 3     | P1       |
| 042   | Seat numbers on video tiles      | 3     | P0       |
| 043   | Rejoin video after disconnect    | 3     | P0       |
| 044   | Screen sharing                   | 3     | P2       |
| 045   | Game session recording           | 3     | P2       |

---

## Cost Estimate (Per Game Session, ~3-4 Hours)

| Service                      | Usage                        | Cost         |
|------------------------------|------------------------------|--------------|
| VM (4 vCPU, 16GB, game-only) | ~4 hours                     | ~$0.50       |
| Azure STT                    | ~2 hours of transcription    | ~$2.00       |
| LLM (Claude, prompt-cached)  | ~50 calls, ~15k tokens avg   | ~$3-5        |
| Azure TTS                    | ~50 responses, ~100 words avg| ~$0.50       |
| **Total per session**        |                              | **~$6-8**    |

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
