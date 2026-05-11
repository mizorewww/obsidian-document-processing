# Development Guide

Use the folder-bound task pipeline for all new document processing features.

## Adding a task

1. Add a stable id in `src/tasks/task-ids.ts`.
2. Create a `TaskDefinition` with:
   - `id` and `name`
   - `defaultPrompt`
   - `processedFrontmatterKey`
   - optional `referencePromptFiles` for bundled prompt context
   - `prepare(input, { prompt, references })`
   - `buildOutput(...)`
3. Keep the LLM output format explicit and machine-validated. Prefer JSON for structured task output.
4. Put task-specific cleanup, parsing, tag handling, and validation in a small helper module with unit tests.
5. Register the task in `src/tasks/index.ts`.

## Binding model

Every automatic feature should be exposed through a `TaskBinding`:

- `folderPath` decides where the task applies.
- `recursive` decides whether child folders are included.
- `promptOverride` lets the user tune behavior for that folder.
- `autoProcess` controls whether the binding participates in automatic processing.

Do not create a separate processed-state database. Each task must use one boolean frontmatter marker, exposed through `processedFrontmatterKey`, as its persistent processed state.

## Safety rules

- Do not write original notes directly from task code.
- Do not bypass `TaskRunner`.
- Do not read or write prompt reference files outside the task/reference mechanism when the content should ship with the plugin; bundle those prompts into source-controlled files.
- Do not write failure state into the source note.
- Always cache original input, raw LLM output, parsed output, final Markdown, and errors when available.
- Keep `Vault.process` hash checks for final writeback.
- Keep LLM requests behind explicit user configuration and folder bindings.

## UI rules

- Use Obsidian native `Setting` controls in the settings tab.
- Keep settings task-centric: list tasks first, then show each task's folder bindings.
- Keep automatic processing as a per-binding switch.
- Add per-binding prompt editing in a modal editor and a restore-default action for every task that supports custom prompting.
- Keep status visible through the status bar and token progress callbacks.

## Required checks

Run these before handing off changes:

```bash
npm run test
npm run build
npm run lint
```
