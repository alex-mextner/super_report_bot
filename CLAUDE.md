# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Super Report Bot — Telegram bot for monitoring group messages with fuzzy matching. Users describe what they're looking for in free-form text, LLM generates keywords, and the system monitors Telegram groups for matching messages.

## Commands

```bash
bun install           # Install dependencies
bun run start         # Start bot (production) — builds webapp first
bun run dev           # Start with hot reload
bun run auth          # Authenticate userbot (MTProto session)
bun test              # Run all tests
bun test src/matcher  # Run specific test directory
bun test --watch      # Run tests in watch mode
bun run webapp:dev    # Run webapp dev server (Vite)
bun run webapp:build  # Build webapp for production
```

## Architecture

```
User sends query → gramio bot → LLM generates keywords → subscription saved to SQLite
                                                                      ↓
User gets notification ← gramio bot ← LLM verifies ← N-gram matcher ← MTProto listener
                                                                      ↓
                                                        Hono API ← Telegram WebApp
```

### Three Main Components

1. **gramio** (`src/bot/`) — Bot API for user interface (commands, keyboards, notifications)
2. **mtcute** (`src/listener/`) — MTProto userbot for listening to group messages
3. **Hono** (`src/api/`) — REST API for Telegram WebApp, validates `initData` from Telegram

The userbot requires separate auth session (`bun run auth`). Session stored in `userbot.session`.

### State Machine (XState v5)

Bot conversation flow is managed by XState in `src/fsm/`:

- `machine.ts` — State machine definition with all states and transitions
- `context.ts` — BotContext type (pending subscription, editing state, etc.)
- `events.ts` — BotEvent type (TEXT_QUERY, CONFIRM, CANCEL, etc.)
- `actions.ts` — Context mutations (assign actions)
- `guards.ts` — Transition conditions
- `persistence.ts` — FSM state persistence to SQLite for recovery
- `adapter.ts` — gramio integration

Key states: `idle` → `clarifyingQuery` → `ratingExamples` → `awaitingConfirmation` → `selectingGroups` → `idle`

### Message Processing Pipeline (3 stages)

1. **N-gram + Jaccard** (`src/matcher/ngram.ts`) — Fast text similarity filter
   - Character-level trigrams + word-level bigrams
   - Threshold: 0.15 for candidates

2. **BGE-M3 Semantic** (`src/llm/embeddings.ts`) — Optional semantic fallback
   - Used when N-gram doesn't match but message might be relevant
   - Requires external BGE server

3. **LLM Verification** (`src/llm/verify.ts`) — Zero-shot classification via BART-MNLI
   - Confirms if message semantically matches subscription description
   - Threshold: >0.6 confidence for match

### LLM Usage

- **Keyword generation**: DeepSeek R1 via HuggingFace Inference (`src/llm/keywords.ts`)
- **Match verification**: facebook/bart-large-mnli for zero-shot classification
- **Message analysis**: Categorization and price extraction for WebApp (`src/llm/analyze.ts`)
- Fallback: simple tokenization if LLM unavailable

### Database

SQLite via `bun:sqlite`. Schema in `src/db/schema.sql`, migrations in `src/db/migrations.ts`.

#### Schema Changes (IMPORTANT)

When modifying database schema, you MUST do BOTH:

1. **Update `src/db/schema.sql`** — for new databases
2. **Create migration in `src/db/migrations/`** — for existing databases

Migration files are named `NNN_description.sql` or `NNN_description.ts` and applied in order. Tracked in `_migrations` table.

**Migrations must be idempotent** — succeed even if schema.sql already applied the change.

**NEVER modify existing migrations** — they may have already been applied to production databases. Always create a new migration file instead.

For **tables/indexes** — use `.sql` with `IF NOT EXISTS`:

```sql
CREATE TABLE IF NOT EXISTS new_table (...);
CREATE INDEX IF NOT EXISTS idx_name ON table(column);
```

For **columns** — use `.ts` migration with helper:

```typescript
// migrations/006_add_new_field.ts
import { Database } from "bun:sqlite";
import { columnExists } from "../migrations";

export function migrate(db: Database) {
  if (!columnExists(db, "users", "new_field")) {
    db.exec("ALTER TABLE users ADD COLUMN new_field TEXT");
  }
}
```

Available helpers in `src/db/migrations.ts`:

- `columnExists(db, table, column)` — check if column exists
- `tableExists(db, table)` — check if table exists

Key tables:

- `users` — telegram_id, mode (normal/advanced)
- `subscriptions` — query, positive/negative keywords (JSON), llm_description
- `subscription_groups` — which groups to monitor per subscription
- `matched_messages` — deduplication
- `messages` — cached messages for WebApp search
- `products`, `categories`, `seller_contacts` — WebApp marketplace features

### WebApp (`webapp/`)

Telegram Mini App for browsing cached messages. Built with Vite, served by Hono from `webapp/dist/`.

## Environment Variables

```
BOT_TOKEN=       # Telegram Bot API token
API_ID=          # Telegram API ID (from my.telegram.org)
API_HASH=        # Telegram API Hash
HF_TOKEN=        # HuggingFace token (optional, for LLM features)
API_PORT=3000    # Hono API port (default: 3000)
ADMIN_ID=        # Telegram user ID for admin features
```

Bun loads `.env` automatically.

## i18n (IMPORTANT)

When changing any text in `src/i18n/`, **ALWAYS update ALL language files**:

- `src/i18n/ru.ts` — Russian
- `src/i18n/en.ts` — English
- `src/i18n/rs.ts` — Serbian

Never change just one language file.

**WebApp i18n**: The webapp has its own i18n files in `webapp/src/i18n/`. All user-facing text must use `t()` from `useLocale()` hook. Never hardcode text strings in JSX. Keys use camelCase (e.g., `adminPresets`).
