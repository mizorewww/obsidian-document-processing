# Architecture

Document Processing is organized around folder-bound task pipelines.

## Core concepts

- **TaskDefinition** describes one processing capability. It owns the default prompt, optional bundled reference prompt files, the processed frontmatter key, LLM request preparation, output parsing, validation, and final Markdown/frontmatter construction.
- **TaskBinding** connects a vault folder to a task. A binding has a folder path, recursive flag, task id, automatic-processing flag, and optional prompt override.
- **AutoProcessor** scans bindings with automatic processing turned on, watches vault events, and runs a single serial queue. It only enqueues Markdown files whose frontmatter does not contain the active task's processed marker.
- **TaskRunner** performs the safe execution path: read original, hash it, write cache files, call the selected LLM, validate output, write `final.md`, then replace the note through `Vault.process` only if the hash still matches.
- **Cache** lives in the plugin folder under `cache/<jobId>/` and records `manifest.json`, `original.md`, `llm-output.json`, `final.md`, and `error.txt` when relevant.

## State flow

Each task owns one persistent processed state in note frontmatter. Web Clipper cleanup uses `llm: true`; Anki card generation uses `anki: true`. Missing values, `false`, `"false"`, and `null` all mean the note is still eligible for that task's automatic processing.

Automatic failures are not written back to the note. Failed jobs are saved to cache for inspection, but automatic eligibility still comes only from the task's frontmatter marker. The queue only deduplicates work that is already queued, not previous failures.

## Data flow

1. A command, startup scan, create event, rename event, or debounced modify event selects a Markdown file.
2. The active folder binding is resolved by the most-specific folder match. Manual commands can use bindings even when automatic processing is off.
3. Auto processing reads frontmatter and skips files with the selected task's processed marker set to `true`.
4. The queue runs one file at a time through `TaskRunner`.
5. The task prompt is `binding.promptOverride` when present, otherwise the task default prompt. Users edit the override from the task's folder binding.
6. LLM token progress is reported to the status bar and written to the cache manifest.
7. The note is replaced only after validation and hash-safe `Vault.process`.

## Current built-in tasks

`web-clipper-bilingual-cleanup` cleans Web Clipper and Wikipedia-style Markdown, generates 3 to 8 English kebab-case tags, removes common clipping noise, and writes `llm: true`. It detects the source language before prompting: mostly non-Chinese articles become source-language/Chinese paired Markdown, while mostly Chinese articles stay Chinese and are only cleaned, structured, and tagged.

`anki-card-generation` creates or updates a note's `# Cards` section for the `obsidian_anki_sync` plugin and writes `anki: true`. It uses bundled prompt reference files for Anki Sync syntax, card-writing quality rules, examples, and the JSON output contract. Existing card UUIDs may be preserved, new cards must not invent UUIDs, and non-empty `path:` lines are sanitized before writeback. The card language setting is inserted before the task prompt so it has the highest priority.
