# Anki card examples

Good examples for the target Markdown format:

```markdown
# Cards

## Concept cloze: active recall

In machine learning, {{c1::overfitting}} means a model performs well on training data but generalizes poorly to unseen data.

tags: ml cloze definition
---

## Multi-cloze: one complete context

High-quality SRS cards should be {{c1::focused}}, {{c2::precise}}, and {{c3::answerable from memory without leaking the answer}}.

Extra

Keep related blanks in one complete context when they belong to the same structure.

tags: srs cloze card-quality
---

## Math cloze: whole formula

For a differentiable function $f(x)$, Newton's method uses:

$${{c1::x_{n+1}=x_n-\frac{f(x_n)}{f'(x_n)}}}$$

One practical condition is that $f'(x)$ near the current point should not be {{c2::close to 0}}.

tags: math numerical-method cloze
---

Front

## Basic: compare two concepts

Distinguish **precision** from **recall**.

Back

- **Precision**: among predicted positives, the share that are truly positive.
- **Recall**: among actual positives, the share that were found.

tags: ml metrics basic
---

type: basic-reversed

Front

## Term

Idempotence

Back

Running the same operation once or multiple times produces the same final effect.

tags: software api reversed
---

type: basic-type

Front

## Exact input: shell

What command removes an empty directory?

Back

rmdir

tags: linux shell typing
---

type: cloze-type

## Spelling cloze: English term

The process of adjusting model parameters using gradients is called {{c1::backpropagation}}.

Extra

Use cloze-type when exact spelling matters.

tags: ml typing english
---
```

Notice:

- New cards do not include a non-empty `uuid:` or `path:`.
- Basic cards do not contain cloze syntax.
- Cards are independently reviewable and keep answers short.
