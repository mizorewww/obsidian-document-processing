# Document Processing

An Obsidian plugin for processing notes and documents with configurable model services.

## Current features

- Use an OpenAI API key.
- Sign in with an OpenAI account.
- Select a preset model or type a custom model ID.
- Choose intelligence and speed preferences when using OpenAI account sign-in.
- Process the current Web Clipper note into cleaner Markdown, using bilingual output only when the source is mostly non-Chinese.
- Create or update Anki cards in a note's `# Cards` section for the `obsidian_anki_sync` plugin.
- Bind processing tasks to vault folders and automatically process new unhandled notes.
- Edit the prompt for each folder binding.
- Cache originals and LLM output before replacing a note.
- Show uploaded and downloaded token counts while a note is being processed.
- Open a queue panel to see running and pending tasks, and cancel one task or the whole queue.
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

## Processing notes

Use **Process current clipping** from the command palette while any Markdown note is open. If the note matches a Web Clipper folder binding, the command uses that binding's prompt; otherwise it runs the built-in Web Clipper cleanup task with its default prompt. The task cleans Web Clipper and Wikipedia-style notes, generates topic tags, and sets `llm: true` in the note properties. Mostly non-Chinese articles are rewritten as source-language paragraphs followed by Chinese paragraphs; mostly Chinese articles stay Chinese and are only cleaned, structured, and tagged.

Use **Create/update Anki cards for current note** to generate or revise the note's `# Cards` section. The task writes cards in the Markdown format expected by `obsidian_anki_sync`, sets `anki: true`, preserves existing UUIDs when it keeps or edits existing cards, and never writes non-empty `path:` lines. Its card language setting defaults to Simplified Chinese and is placed at the top of the prompt.

Folder tasks are configured in **Settings -> Community plugins -> Document Processing -> Processing**. The page lists each task first; under each task, add the vault folders that should use it. Each folder chooses whether automatic processing is on, whether subfolders are included, and whether to use a custom prompt. Prompt editing opens in a larger Markdown-style editor.

Each task owns its persistent processed marker. Web Clipper cleanup uses `llm: true`; Anki card generation uses `anki: true`. `false`, `"false"`, missing values, and `null` are treated as unprocessed for that task. Failed automatic runs do not write failure state into the note. The cache records the failure, but automatic eligibility still comes from the task marker in the note. Use **Open document processing queue** to inspect running and pending tasks, or **Cancel document processing queue** to stop queued work.

While the model is working, the plugin shows uploaded and downloaded token counts in a persistent notice and the status bar. A `~` prefix means the number is estimated; exact usage is shown when the service returns it.

Before replacing the note, the plugin writes a cache record to its plugin folder with the original note, raw model output, final Markdown, and a job manifest. If the model output fails validation or the note changes while processing, the original note is left untouched.

## Development

Architecture and extension notes:

- [Architecture](docs/ARCHITECTURE.md)
- [Development guide](docs/DEVELOPMENT.md)

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run test
```

Release artifacts are `main.js`, `manifest.json`, and `styles.css`.
