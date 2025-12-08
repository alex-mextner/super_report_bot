# Super Report Bot

Telegram bot for monitoring group messages with fuzzy matching. Describe what you're looking for in natural language, and the bot will notify you when matching messages appear.

## How It Works

1. User sends a free-form search query (e.g., "selling iPhone 15 under $500")
2. LLM generates positive/negative keywords and a semantic description
3. User confirms or edits the keywords, selects groups to monitor
4. MTProto userbot listens to messages in those groups
5. Messages pass through 3-stage matching: N-gram filter → keyword scoring → LLM verification
6. Matching messages are forwarded to the user

## Setup

### Prerequisites

- [Bun](https://bun.sh) runtime
- Telegram Bot token (from [@BotFather](https://t.me/BotFather))
- Telegram API credentials (from [my.telegram.org](https://my.telegram.org))
- HuggingFace token (optional, for LLM features)

### Installation

```bash
bun install
```

### Configuration

Create `.env` file:

```conf
BOT_TOKEN=your_bot_token
API_ID=your_api_id
API_HASH=your_api_hash
HF_TOKEN=your_huggingface_token
```

### Authenticate Userbot

The userbot needs to be authenticated once:

```bash
bun run auth
```

This creates a `userbot.session` file. Add the userbot account to the groups you want to monitor.

### Run

```bash
bun run start     # Production
bun run dev       # With hot reload
```

## Architecture

- **gramio** — Bot API for user interaction
- **mtcute** — MTProto client for reading group messages
- **bun:sqlite** — Local database for subscriptions and deduplication
- **HuggingFace Inference** — DeepSeek R1 for keyword generation, BART-MNLI for verification

## License

MIT
