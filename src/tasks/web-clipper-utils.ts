export interface WebClipperLlmResult {
	markdown: string;
	tags: string[];
}

export type WebClipperLanguageMode = "bilingual" | "chinese-cleanup";

export const DEFAULT_WEB_CLIPPER_PROMPT = [
	"You are cleaning a saved web clipping for an Obsidian knowledge vault.",
	"Use the successful target style from a cleaned Wikipedia finance article:",
	"- Keep useful metadata concepts stable: title, created date, source URL, topic tags, and llm status are handled by the plugin.",
	"- If the source article is mostly English or another non-Chinese language, produce a clean bilingual article body: source-language heading or paragraph first, then the matching Chinese heading or paragraph immediately after it.",
	"- If the source article is mostly Chinese, do not force bilingual translation. Keep the article in Chinese and focus on cleanup, structure, metadata tags, and noise removal.",
	"- Keep important Obsidian image embeds and short captions.",
	"- Keep formulas, but remove redundant LaTeX markers such as \\displaystyle.",
	"- Remove Wikipedia reference lists, footnote definitions, navigation clutter, and external-link sections.",
	"- Preserve necessary inline source links, but do not keep large citation dumps.",
	"- Do not add facts that are not in the original article.",
	"- Return 3 to 8 stable English kebab-case tags, such as asset-pricing, market-efficiency, or behavioral-finance.",
].join("\n");

export function buildWebClipperPrompt(input: {
	filePath: string;
	frontmatter: Record<string, unknown>;
	body: string;
	taskPrompt: string;
}): string {
	const languageMode = detectWebClipperLanguageMode(input.body);

	return [
		input.taskPrompt.trim() || DEFAULT_WEB_CLIPPER_PROMPT,
		"",
		"Return only a JSON object with this exact shape:",
		'{"markdown":"...","tags":["tag-one","tag-two","tag-three"]}',
		"",
		"Hard rules for markdown:",
		"- Do not include YAML frontmatter. The plugin will write metadata.",
		"- Use standard Markdown headings and paragraphs.",
		"- Remove all LaTeX \\displaystyle markers.",
		"- Do not add facts that are not in the original article.",
		...getLanguageModeRules(languageMode),
		"",
		"Rules for tags:",
		"- Return 3 to 8 English kebab-case tags.",
		"- Do not include #.",
		"- Prefer stable topic tags over overly specific names.",
		"",
		`File path: ${input.filePath}`,
		`Detected language mode: ${languageMode}`,
		`Existing metadata: ${JSON.stringify(input.frontmatter)}`,
		"",
		"Article markdown:",
		stripWikipediaNoise(input.body),
	].join("\n");
}

export function detectWebClipperLanguageMode(markdown: string): WebClipperLanguageMode {
	const text = getLanguageDetectionText(markdown);
	const cjkCharacters = countMatches(text, /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/gu);
	const latinLetters = countMatches(text, /[a-z]/giu);
	const measuredCharacters = cjkCharacters + latinLetters;

	if (measuredCharacters < 20) {
		return "bilingual";
	}

	return cjkCharacters / measuredCharacters >= 0.5 ? "chinese-cleanup" : "bilingual";
}

export function stripWikipediaNoise(markdown: string): string {
	return compactBlankLines(
		removeFootnoteDefinitionBlock(
			removeMarkdownLinkTitles(
				removeDisplayStyle(markdown),
			),
		),
	).trim();
}

export function sanitizeFinalMarkdown(markdown: string): string {
	return compactBlankLines(
		removeFootnoteDefinitionBlock(
			removeInlineFootnoteMarkers(
				removeMarkdownLinkTitles(
					removeDisplayStyle(markdown),
				),
			),
		),
	).trim();
}

export function parseWebClipperLlmResult(rawText: string): WebClipperLlmResult {
	const payload = parseJsonObject(rawText) as {
		markdown?: unknown;
		tags?: unknown;
	};

	if (typeof payload.markdown !== "string") {
		throw new Error("LLM output is missing markdown.");
	}

	if (!Array.isArray(payload.tags)) {
		throw new Error("LLM output is missing tags.");
	}

	const markdown = sanitizeFinalMarkdown(payload.markdown);
	validateMarkdown(markdown);

	const tags = normalizeTags(payload.tags);
	if (tags.length < 3 || tags.length > 8) {
		throw new Error("LLM output must include 3 to 8 valid tags.");
	}

	return {
		markdown,
		tags,
	};
}

export function normalizeTags(values: unknown[]): string[] {
	const seen = new Set<string>();
	const tags: string[] = [];

	for (const value of values) {
		if (typeof value !== "string") {
			continue;
		}

		const tag = normalizeTag(value);
		if (!tag || seen.has(tag)) {
			continue;
		}

		seen.add(tag);
		tags.push(tag);
	}

	return tags;
}

export function normalizeTag(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.normalize("NFKD")
		.replace(/^#+/u, "")
		.replace(/['’]/gu, "")
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
}

export function mergeTags(existingValue: unknown, generatedTags: string[]): string[] {
	const existingTags = Array.isArray(existingValue)
		? normalizeTags(existingValue)
		: typeof existingValue === "string"
			? normalizeTags([existingValue])
			: [];

	return normalizeTags([...existingTags, ...generatedTags]).sort((left, right) => left.localeCompare(right));
}

function validateMarkdown(markdown: string): void {
	if (!markdown.trim()) {
		throw new Error("LLM output markdown is empty.");
	}

	if (/^```[\s\S]*```$/u.test(markdown.trim())) {
		throw new Error("LLM output markdown must not be wrapped in a code fence.");
	}

	if (markdown.includes("\\displaystyle")) {
		throw new Error("LLM output still contains \\displaystyle.");
	}

	if (/^\[\^[^\]]+\]:/mu.test(markdown)) {
		throw new Error("LLM output still contains footnote definitions.");
	}
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

function removeDisplayStyle(markdown: string): string {
	return markdown.replace(/\\displaystyle\s*/gu, "");
}

function removeMarkdownLinkTitles(markdown: string): string {
	return markdown.replace(/\]\((\S+)\s+"[^"]*"\)/gu, "]($1)");
}

function removeInlineFootnoteMarkers(markdown: string): string {
	return markdown.replace(/\[\^[^\]]+\]/gu, "");
}

function removeFootnoteDefinitionBlock(markdown: string): string {
	const lines = markdown.split(/\r?\n/u);
	const firstFootnoteIndex = lines.findIndex((line) => /^\[\^[^\]]+\]:/u.test(line));
	if (firstFootnoteIndex < 0) {
		return markdown;
	}

	return lines.slice(0, firstFootnoteIndex).join("\n");
}

function compactBlankLines(markdown: string): string {
	return markdown
		.replace(/[ \t]+$/gmu, "")
		.replace(/\n{3,}/gu, "\n\n");
}

function getLanguageModeRules(languageMode: WebClipperLanguageMode): string[] {
	if (languageMode === "chinese-cleanup") {
		return [
			"- The article is mostly Chinese. Do not create English/Chinese paired paragraphs.",
			"- Keep Chinese paragraphs in Chinese, improve Markdown structure, remove clipping noise, and preserve useful original facts.",
			"- Keep existing English names, terms, titles, and links when they are useful, but do not translate the whole article into English.",
			"- Headings should be natural Chinese headings unless the original heading already includes a useful English title.",
		];
	}

	return [
		"- The article is mostly non-Chinese. Write each source-language paragraph first, followed immediately by a faithful Chinese paragraph.",
		"- Make headings bilingual too, with the source-language heading first and Chinese after a slash.",
	];
}

function getLanguageDetectionText(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?```/gu, " ")
		.replace(/`[^`]*`/gu, " ")
		.replace(/https?:\/\/\S+/giu, " ")
		.replace(/!\[\[[^\]]+\]\]/gu, " ")
		.replace(/!\[[^\]]*\]\([^)]+\)/gu, " ")
		.replace(/\[[^\]]+\]\([^)]+\)/gu, " ")
		.replace(/[0-9\s\p{P}\p{S}]+/gu, " ");
}

function countMatches(text: string, pattern: RegExp): number {
	return text.match(pattern)?.length ?? 0;
}
