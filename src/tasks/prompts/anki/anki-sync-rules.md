# Obsidian Anki Sync rules

Generate cards for an Obsidian note that will later be parsed by the `obsidian_anki_sync` plugin.

Hard format rules:

- All cards must live under one `# Cards` heading.
- Separate cards with a single line containing exactly `---`.
- New cards must omit `uuid:` or leave it blank.
- Existing cards that are kept or edited must keep their original `uuid:` exactly.
- Never invent a UUID.
- Never write a non-empty `path:` line. The Anki Sync plugin writes and updates paths.
- Existing cards may already contain `path: some/file.md`; do not copy that value into the output. Remove the line or write `path:` with no value.
- Use Markdown, LaTeX, and code fences normally; do not write HTML.
- A card may include `tag:` or `tags:` with short, useful tags.

Supported card shapes:

```markdown
# Cards

## Concept cloze

The key answer is {{c1::hidden text}}.

tags: topic cloze
---

Front

## Basic question

What precise question should be answered?

Back

The concise answer.

tags: topic basic
---
```

Supported explicit `type:` aliases:

- `cloze`
- `cloze-type`
- `basic`
- `basic-reversed`
- `basic-type`

Important constraints:

- Prefer Cloze notes over Basic question-answer notes when the knowledge can be tested by fill-in blanks.
- A single Cloze note can and often should contain multiple blanks when the blanks share one coherent context. Use `{{c1::...}}`, `{{c2::...}}`, `{{c3::...}}` in the same note for related items instead of splitting them into many context-poor one-line notes.
- Basic, basic-reversed, and basic-type cards must not contain Anki cloze syntax anywhere in Front, Back, code blocks, or explanations.
- If a card contains `{{c1::...}}`, do not set a Basic type.
- `basic-type` is only for short exact answers, spelling, symbols, or commands.
- `basic-reversed` is for compact term-definition pairs, not long explanations.
- Do not put an extra horizontal rule line `---` inside a card.
