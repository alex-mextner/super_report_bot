# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Super Report Bot — Telegram bot for monitoring group messages with fuzzy matching. Users describe what they're looking for in free-form text, LLM generates keywords, and the system monitors Telegram groups for matching messages.

## Commands

```bash
bun install          # Install dependencies
bun run start        # Start bot (production)
bun run dev          # Start with hot reload
bun run auth         # Authenticate userbot (MTProto session)
bun test             # Run all tests
bun test src/matcher # Run specific test directory
```

## Architecture

```
User sends query → gramio bot → LLM generates keywords → subscription saved to SQLite
                                                                      ↓
User gets notification ← gramio bot ← LLM verifies ← N-gram matcher ← MTProto listener
```

### Two Telegram Clients

1. **gramio** (`src/bot/`) — Bot API for user interface (commands, keyboards, notifications)
2. **mtcute** (`src/listener/`) — MTProto userbot for listening to group messages

The userbot requires separate auth session (`bun run auth`). Session stored in `userbot.session`.

### Message Processing Pipeline (3 stages)

1. **N-gram + Jaccard** (`src/matcher/ngram.ts`) — Fast text similarity filter
   - Character-level trigrams + word-level bigrams
   - Threshold: 0.15 for candidates

2. **Keyword matching** — Binary + soft coverage scoring
   - Keyword "found" if ≥70% of its n-grams present in text
   - Logic is OR-like: single keyword match passes threshold

3. **LLM Verification** (`src/llm/verify.ts`) — Zero-shot classification via BART-MNLI
   - Confirms if message semantically matches subscription description
   - Threshold: >0.6 confidence for match

### LLM Usage

- **Keyword generation**: DeepSeek R1 via HuggingFace Inference (Novita provider)
- **Match verification**: facebook/bart-large-mnli for zero-shot classification
- Fallback: simple tokenization if LLM unavailable

### Database

SQLite via `bun:sqlite`. Schema in `src/db/schema.sql`.

Key tables:
- `users` — telegram_id
- `subscriptions` — query, positive/negative keywords (JSON), llm_description
- `subscription_groups` — which groups to monitor per subscription
- `matched_messages` — deduplication

### Conversation Flow State Machine

```
idle → awaiting_confirmation → selecting_groups → idle
         ↓                          ↓
   editing_keywords            (saves subscription)
         ↓
   awaiting_confirmation
```

State stored in-memory (`Map<userId, UserState>`).

## Environment Variables

```
BOT_TOKEN=       # Telegram Bot API token
API_ID=          # Telegram API ID (from my.telegram.org)
API_HASH=        # Telegram API Hash
HF_TOKEN=        # HuggingFace token (optional, for LLM features)
```

Bun loads `.env` automatically.

## Key Files

- `src/index.ts` — Entry point, starts both clients
- `src/bot/index.ts` — Bot commands and callback handlers
- `src/listener/index.ts` — MTProto message listener and group scanning
- `src/matcher/ngram.ts` — N-gram similarity algorithms
- `src/llm/keywords.ts` — Keyword generation prompt and parsing
- `src/llm/verify.ts` — Zero-shot classification for match verification
