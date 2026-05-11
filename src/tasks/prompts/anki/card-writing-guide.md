# Card-writing quality guide

Treat card writing as designing future retrieval tasks, not as summarizing the note.

Core principles:

- One card should test one core fact, relationship, cause, step, judgment, or application.
- Questions must be concrete and precise, with enough context to answer reliably.
- Answers must be stable and short enough to grade during review.
- Avoid broad prompts such as "explain X" or "what is the meaning of X".
- Avoid yes/no cards and recognition-only cards when an active recall card is possible.
- Prefer cloze/fill-in cards over Basic question-answer cards.
- An Anki Cloze note may contain multiple blanks. When several blanks belong to the same definition, contrast, formula, process, causal chain, or classification, prefer one context-rich Cloze note with `{{c1::...}}`, `{{c2::...}}`, `{{c3::...}}` over several isolated one-blank notes.
- Keep the surrounding sentence or paragraph complete enough that each blank is reviewable in context. Do not split a coherent idea into many tiny cards that lose the original context.
- Use Basic cards for concise explanation, comparison, code reading, and applied scenario prompts.
- If an answer has more than three independent points, split it into multiple cards.
- Do not add unsupported facts. If the note does not support a card, do not create that card.

Card type guidance:

- Fact cards: terms, definitions, numbers, people, dates, classifications, and conclusions.
- Concept cards: definition, feature, boundary, contrast, example, mechanism, and use case.
- Procedure cards: next step, condition, order, trigger, and common mistake.
- Application cards: concrete scenario on the front, actionable concept or method on the back.
- Insight cards: long-term attention or reflection prompts; mark them clearly in the title or tags.

Selection guidance:

- Prefer 10 to 20 high-quality cards for a normal dense note.
- For short notes, create 5 to 10 cards.
- For long or information-dense notes, create up to 20 to 40 cards only when the material genuinely supports them.
- Cloze cards should be the default when the material contains definitions, lists, steps, classifications, formulas, causal chains, or comparisons.
- For dense structured material, most generated Anki notes should be Cloze notes, and many of those Cloze notes should contain multiple blanks in one complete context.
- Deliberately skip low-value details, incidental examples, source navigation, and content that is not worth repeated review.

Before final output, silently self-check every card:

- Does it test one point?
- Is the prompt specific?
- Is the answer stable?
- Is it answerable without the full note?
- Does it avoid leaking the answer?
- Could it be a better cloze card?
- If it is a cloze card, would several related blanks be better kept in one complete-context note instead of being split apart?
- Is it worth long-term review?
