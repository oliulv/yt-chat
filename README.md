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

1.  Open any YouTube video.
2.  Open the Side Panel (if not already open).
3.  The extension will open the YouTube transcript drawer in the background, scrape it, and hide it.
4.  Wait for the status to show `TRANSCRIPT LOADED. READY.`
5.  Type your question in the input field and press `Enter` or click `EXEC`.

## Troubleshooting

- **Transcript not loading**: Make sure you are on a `youtube.com/watch` page with a transcript/captions available (manual or auto, any language YouTube exposes). Refresh the page and reopen the side panel.
- **Content script not responding**: Reload the tab and toggle the side panel; the content script pings and reinjects if needed, but a fresh tab is safest.
- **API errors**: Verify your API key and OpenAI balance. Check Options to ensure the model is set.
- **Publishing**: Zip the extension folder (with `manifest.json`, `content.js`, `sidepanel.html/js`, `styles.css`, `assets/` icons) and upload via the Chrome Web Store Developer Dashboard after bumping the manifest `version`. Provide a privacy blurb noting transcripts are read client-side and prompts go to OpenAI with your key.
