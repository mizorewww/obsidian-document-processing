# Document Processing

An Obsidian plugin for processing notes and documents with configurable model services.

## Current features

- Use an OpenAI API key.
- Sign in with an OpenAI account.
- Select a preset model or type a custom model ID.
- Choose intelligence and speed preferences when using OpenAI account sign-in.
- Check whether the selected model works.
- Switch the settings UI between Simplified Chinese and English.

## Model service setup

### OpenAI API key

1. Open **Settings -> Community plugins -> Document Processing**.
2. Select **OpenAI API key**.
3. Enter your OpenAI API key.
4. Select a model.
5. Select **Check**.

The API key is stored in this plugin's local Obsidian data.

### OpenAI account

1. Open **Settings -> Community plugins -> Document Processing**.
2. Select **OpenAI account**.
3. Select **Sign in**.
4. Open the sign-in page and enter the one-time code shown in Obsidian. The plugin copies the code to your clipboard automatically when possible.
5. Select a model.
6. Choose an intelligence level and speed tier if you want to override the defaults.
7. Select **Check**.

## Privacy

Test messages and future document-processing requests are sent to OpenAI only when you choose an OpenAI-backed service. Your API key or sign-in session is stored in this plugin's local Obsidian data, which may be synced if you sync your vault configuration. This plugin does not add telemetry or analytics.

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Release artifacts are `main.js`, `manifest.json`, and `styles.css`.
