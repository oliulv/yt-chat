# YT Cryptic Chat - Chrome Extension

A minimalist, terminal-style chatbot assistant for YouTube that loads video transcripts into context and allows you to chat with OpenAI about the content.

## Features

- **Cryptic UI**: Clean, dark-mode, terminal-inspired interface.
- **Context-Aware**: Scrapes the on-page transcript (no caption API fetches/CORS issues).
- **OpenAI Integration**: Uses your own OpenAI API Key (supports GPT-4o, GPT-4o-mini, etc.).
- **Side Panel**: Stays open alongside the video for uninterrupted viewing.

## Installation

1.  **Clone or Download** this repository.
2.  Open Google Chrome and navigate to `chrome://extensions/`.
3.  Toggle **Developer mode** (top right corner).
4.  Click **Load unpacked**.
5.  Select the folder containing this project.

## Configuration

1.  Click the extension icon in the toolbar to open the Side Panel.
2.  Click the **⚙ (Settings)** icon in the status bar.
3.  Enter your **OpenAI API Key** (get one at [platform.openai.com](https://platform.openai.com/api-keys)).
4.  Select your preferred model (e.g., `gpt-4o-mini` for speed/cost, `gpt-4o` for intelligence).
5.  Click **SAVE_CONFIG**.

## Usage

### YouTube transcripts
1. Open any YouTube video.
2. Open the Side Panel (if not already open).
3. The extension opens the transcript drawer in the background, scrapes it, and hides it.
4. Wait for the status to show `CONTEXT ACQUIRED: ...`.
5. Ask questions and press `Enter` or click `EXEC`.

### Webpage /context scraping (case-insensitive)
- Type `/context` anywhere in the input to scrape the currently active tab (non-YouTube). The command is case-insensitive: `/context`, `/Context`, `/CONTEXT` all work.
- You can optionally add a question after it, e.g. `/context what is the main idea?`
- If you only type `/context`, it scrapes and loads the page context, then waits for your next question.
- Scraped page content or transcripts are fed into the same chat so you can deep-dive across tabs and mediums without losing context. Switching between articles and YouTube videos will keep the ongoing chat thread; closing the side panel still resets history unless you turn on PERSIST.

### Persistence toggle
- `[PERSIST: OFF]` by default. Turn it on in the status bar if you want chat history to survive side panel closes.
- With persist on, chat history and context (transcript or scraped page) are reused across tabs and mediums.
