# Output contract

Return only valid JSON. Do not wrap the JSON in Markdown fences.

The JSON shape is:

```json
{
  "cardsMarkdown": "# Cards\n\n...",
  "changeSummary": [
    "short note about what changed"
  ]
}
```

`cardsMarkdown` must be a complete replacement for the note's `# Cards` section.
You may add useful cards, delete weak or unsupported cards, and revise existing cards.

Rules for `cardsMarkdown`:

- It must start with `# Cards`.
- It must not include YAML frontmatter.
- It must contain only cards, card separators, and card metadata for Anki Sync.
- Prefer context-rich Cloze notes with multiple related blanks over Basic question-answer cards when the source material supports it.
- It may preserve existing card UUIDs when keeping or editing those cards.
- It must omit `uuid:` for new cards or leave it blank.
- It must never include a non-empty `path:`.
- It must not include commentary outside the cards.

The plugin will write frontmatter and will set `anki: true` after validation.
