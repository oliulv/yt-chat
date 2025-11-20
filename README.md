# YT Cryptic Chat - Chrome Extension

A minimalist, terminal-style chatbot assistant for YouTube that loads video transcripts into context and allows you to chat with OpenAI about the content.

## Features

- **Cryptic UI**: Clean, dark-mode, terminal-inspired interface.
- **Context-Aware**: Automatically fetches and parses the transcript of the current YouTube video.
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
3.  Wait for the status to change to `TRANSCRIPT LOADED. READY.`
4.  Type your question in the input field and press `Enter` or click `EXEC`.

## Troubleshooting

-   **No Transcript Found**: Some videos do not have captions/transcripts enabled. The extension currently requires English captions (manual or auto-generated).
-   **API Error**: Check your API key and credit balance on OpenAI.

