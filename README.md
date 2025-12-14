# Pam - Chrome Extension

A minimalist, terminal-style chatbot assistant that auto-pulls context from the page you're on (articles or YouTube transcripts) and lets you chat with cutting-edge AI models via OpenRouter.

## Features

- **Cryptic UI**: Clean, dark-mode, terminal-inspired interface.
- **Auto Context**: Scrapes the active webpage or YouTube transcript (no caption API fetches/CORS issues) without extra commands.
- **OpenRouter Integration**: Uses your own OpenRouter API Key (supports GPT-5.2, Claude Sonnet 4.5, Gemini 3 Pro, Grok 4.1, DeepSeek v3.2, and more).
- **Side Panel**: Stays open alongside the content for uninterrupted reading/viewing.

## Installation

1.  **Clone or Download** this repository.
2.  Open Google Chrome and navigate to `chrome://extensions/`.
3.  Toggle **Developer mode** (top right corner).
4.  Click **Load unpacked**.
5.  Select the folder containing this project.

## Configuration

1.  Click the extension icon in the toolbar to open the Side Panel.
2.  Click the **⚙ (Settings)** icon in the status bar.
3.  Enter your **OpenRouter API Key** (get one at [openrouter.ai](https://openrouter.ai/keys)).
4.  Select your preferred model from the cutting-edge options (e.g., `google/gemini-2.5-flash` for speed/cost, `anthropic/claude-sonnet-4.5` for intelligence).
5.  Click **SAVE_CONFIG**.

## Usage

### General browsing (articles and docs)
1. Open a webpage (non-YouTube).
2. Type your question and hit `Enter` / `EXEC`.
3. The extension auto-scrapes the active tab once and attaches that content to your first message so the LLM answers with page context.

### YouTube transcripts
1. Open any YouTube video.
2. The extension opens the transcript drawer in the background, scrapes it, and hides it.
3. Ask your question; the transcript is attached once and reused.

### Optional `/context` command (back-compat)
- You can still type `/context` (any casing) to force scraping the current non-YouTube page, optionally followed by a question. Otherwise, auto-scrape handles it.

### Persistence toggle
- `[PERSIST: OFF]` by default. Turn it on in the status bar if you want chat history to survive side panel closes.
- With persist on, chat history and context (transcript or scraped page) are reused across tabs and mediums; with it off, closing the side panel resets.
