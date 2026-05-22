import { buildMarkdownWithFrontmatter } from "../markdown/frontmatter";
import { TaskDefinition, TaskInput, TaskOutput, TaskPrepareOptions } from "./types";

export const NOTE_FORMATTING_TASK_ID = "note-formatting";

export interface NoteFormattingLlmResult {
	markdown: string;
	changeSummary: string[];
}

export const DEFAULT_NOTE_FORMATTING_PROMPT = [
	"You format an Obsidian Markdown note with minimum necessary edits.",
	"Strictly preserve meaning, wording, paragraph order, heading names, link targets, tags, YAML semantics, code content, formulas, paths, and filenames.",
	"Only change surface formatting: spaces, punctuation width, Markdown block structure, quote/list/table spacing, blank lines, and missing fenced-code language labels when the language is clear.",
	"Add one ASCII space between Chinese and English, and between Chinese and numbers.",
	"Use ASCII punctuation for Chinese prose, followed by one ASCII space unless the punctuation is at the end of a line or inside protected syntax.",
	"Do not insert spaces inside decimals, version numbers, filenames, URLs, paths, email addresses, inline code, commands, regular expressions, math, Obsidian links, tags, embeds, block IDs, Dataview queries, callouts, template variables, or code fences.",
	"Do not modify content inside code fences or inline code. For fenced code blocks, only add or correct the language marker when it is obvious; otherwise use text.",
	"Do not force hard wrapping of prose.",
	"Remove trailing whitespace and accidental repeated spaces in normal prose only.",
].join("\n");

export const NOTE_FORMATTING_TASK: TaskDefinition = {
	id: NOTE_FORMATTING_TASK_ID,
	name: "Note formatting",
	defaultPrompt: DEFAULT_NOTE_FORMATTING_PROMPT,
	processedFrontmatterKey: "formatted",
	prepare(input: TaskInput, options: TaskPrepareOptions) {
		return {
			instructions: [
				"You format Obsidian Markdown notes.",
				"Return only valid JSON. Do not wrap the JSON in Markdown fences.",
				"Do not rewrite, summarize, translate, add facts, or remove user content.",
				"Treat Obsidian-specific syntax and code/math-like regions as protected data.",
			].join(" "),
			prompt: buildNoteFormattingPrompt({
				filePath: input.filePath,
				frontmatter: input.frontmatter,
				body: input.body,
				taskPrompt: options.prompt,
			}),
			maxOutputTokens: 20000,
		};
	},
	buildOutput(input: TaskInput, rawLlmText: string, stringifyFrontmatter: (frontmatter: Record<string, unknown>) => string): TaskOutput {
		const parsedOutput = parseNoteFormattingLlmResult(rawLlmText);
		const nextFrontmatter = {
			...input.frontmatter,
			formatted: true,
		};
		const frontmatterYaml = stringifyFrontmatter(nextFrontmatter);

		return {
			finalMarkdown: buildMarkdownWithFrontmatter(frontmatterYaml, parsedOutput.markdown),
			parsedOutput,
			generatedTags: [],
		};
	},
};

export function buildNoteFormattingPrompt(input: {
	filePath: string;
	frontmatter: Record<string, unknown>;
	body: string;
	taskPrompt: string;
}): string {
	return [
		input.taskPrompt.trim() || DEFAULT_NOTE_FORMATTING_PROMPT,
		"",
		"Return only a JSON object with this exact shape:",
		'{"markdown":"...","changeSummary":["short change type"]}',
		"",
		"Hard rules:",
		"- Do not include YAML frontmatter. The plugin preserves and writes metadata.",
		"- Return the full formatted Markdown body, not a patch and not a summary.",
		"- Keep all original facts, sentences, paragraphs, headings, links, tags, embeds, block IDs, callouts, formulas, and code content.",
		"- Do not rename headings, reorder sections, change link targets, change tags, or change frontmatter semantics.",
		"- Protect [[wikilinks]], [[page#heading]], [[page|alias]], ![[embeds]], #tags, ^block-id, $math$, $$math$$, Dataview/Tasks/Mermaid blocks, template variables, URLs, paths, emails, and inline code.",
		"- Use fenced code blocks. Add a language marker only when clear; use text for logs or unknown snippets.",
		"- Keep prose line breaks close to the original. Do not hard-wrap paragraphs.",
		"- The changeSummary list should contain only concise formatting categories.",
		"",
		`File path: ${input.filePath}`,
		`Existing metadata, for context only: ${JSON.stringify(input.frontmatter)}`,
		"",
		"Markdown body:",
		input.body,
	].join("\n");
}

export function parseNoteFormattingLlmResult(rawText: string): NoteFormattingLlmResult {
	const payload = parseJsonObject(rawText) as {
		markdown?: unknown;
		changeSummary?: unknown;
	};

	if (typeof payload.markdown !== "string") {
		throw new Error("LLM output is missing markdown.");
	}

	const markdown = normalizeReturnedMarkdown(payload.markdown);
	validateFormattedMarkdown(markdown);

	return {
		markdown,
		changeSummary: normalizeChangeSummary(payload.changeSummary),
	};
}

function normalizeReturnedMarkdown(markdown: string): string {
	const trimmed = markdown.trim();
	const markdownFenceMatch = /^```(?:markdown|md)\s*\n([\s\S]*?)\n```$/iu.exec(trimmed);
	return markdownFenceMatch ? (markdownFenceMatch[1] ?? "").trim() : trimmed;
}

function validateFormattedMarkdown(markdown: string): void {
	if (!markdown.trim()) {
		throw new Error("LLM output markdown is empty.");
	}

	if (/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/u.test(markdown)) {
		throw new Error("LLM output must not include YAML frontmatter.");
	}
}

function normalizeChangeSummary(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(Boolean)
		.slice(0, 8);
}

function parseJsonObject(rawText: string): unknown {
	const trimmed = rawText.trim();
	const unwrapped = unwrapCodeFence(trimmed);

	try {
		return JSON.parse(unwrapped);
	} catch {
		const start = unwrapped.indexOf("{");
		const end = unwrapped.lastIndexOf("}");
		if (start < 0 || end <= start) {
			throw new Error("LLM output is not valid JSON.");
		}

		return JSON.parse(unwrapped.slice(start, end + 1));
	}
}

function unwrapCodeFence(value: string): string {
	const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(value);
	return fenceMatch?.[1] ?? value;
}
