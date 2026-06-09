# Avalon Online

A real-time multiplayer web application for playing the social deduction game "Avalon" online.

## Tech Stack

- **Frontend**: Next.js 14+ (App Router), React 18+, TypeScript 5.x, Tailwind CSS 3.x
- **Backend**: Next.js API Routes, self-hosted Supabase (Postgres 17 + GoTrue Auth + Realtime)
- **Hosting**: Self-hosted — Docker + Traefik on a GCP VM
- **Testing**: Vitest (unit), Playwright (E2E)

> **Deploying / self-hosting:** the production stack (Next.js app + self-hosted Supabase) runs via Docker.
> See [`docs/deploy-from-scratch.md`](docs/deploy-from-scratch.md) and [`docs/self-host-supabase-plan.md`](docs/self-host-supabase-plan.md).
> The cloud-Supabase steps in "Getting Started" below are from the original setup and are now superseded.

## Getting Started

### Prerequisites

- Node.js 20.x or later
- npm 10.x or later
- Supabase account and project

### 1. Clone and Install

```bash
git clone <repository-url>
cd avalon-online
npm install
```

### 2. Supabase Setup

1. Create a new Supabase project at [supabase.com](https://supabase.com)

2. Run the database migrations in order:
   ```sql
   -- Run in Supabase SQL Editor:
   -- 1. supabase/migrations/001_initial_schema.sql
   -- 2. supabase/migrations/002_rls_policies.sql
   -- 3. supabase/migrations/003_functions.sql
   ```

3. Enable Realtime for the following tables:
   - `rooms`
   - `room_players`
   - `player_roles`

4. Copy your project credentials from Settings > API

### 3. Environment Variables

Create a `.env.local` file in the project root:

```env
# Supabase (required) - Get from Supabase Dashboard > Settings > API
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Server-only (NEVER expose to client or commit to git)
SUPABASE_SERVICE_ROLE_KEY=
```

**Where to find these:**
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project → **Settings** → **API**
3. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role secret** key → `SUPABASE_SERVICE_ROLE_KEY`

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run test` | Run unit tests |
| `npm run test:e2e` | Run E2E tests |

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes
│   ├── rooms/             # Room pages
│   └── game/              # Game pages
├── components/
│   └── ui/                # Reusable UI components
├── hooks/                 # Custom React hooks
├── lib/
│   ├── supabase/         # Database clients and queries
│   ├── domain/           # Business logic (pure functions)
│   └── utils/            # Utility functions
├── types/                 # TypeScript types
└── styles/               # Global styles

tests/
├── unit/                  # Unit tests (Vitest)
├── integration/          # Integration tests
└── e2e/                  # End-to-end tests (Playwright)

specs/                     # Feature specifications
└── 001-avalon-mvp-lobby/ # MVP Lobby specification

supabase/
└── migrations/           # Database migrations
```

## Game Rules (MVP)

### Roles
- **Good (Loyal Servants of Arthur)**: Work to complete quests
- **Evil (Minions of Mordred)**: Sabotage the quests

### Role Distribution
| Players | Good | Evil |
|---------|------|------|
| 5 | 3 | 2 |
| 6 | 4 | 2 |
| 7 | 4 | 3 |
| 8 | 5 | 3 |
| 9 | 6 | 3 |
| 10 | 6 | 4 |

### MVP Flow
1. Create a room (5-10 players)
2. Share room code with friends
3. Players join using the room code
4. Room manager distributes roles when full
5. Each player confirms their role
6. Game starts (placeholder for full game)

## Development

### Running Tests

```bash
# Unit tests
npm run test

# Unit tests with UI
npm run test:ui

# E2E tests (requires dev server running)
npm run test:e2e
```

### Code Style

This project uses:
- ESLint with strict TypeScript rules
- Prettier for formatting
- Tailwind CSS for styling

## License

Private - All rights reserved
