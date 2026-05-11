import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
	buildWebClipperPrompt,
	detectWebClipperLanguageMode,
	mergeTags,
	normalizeTag,
	normalizeTags,
	parseWebClipperLlmResult,
	stripWikipediaNoise,
} = await jiti.import("../src/tasks/web-clipper-utils.ts");
const {
	buildMarkdownWithFrontmatter,
	splitFrontmatter,
} = await jiti.import("../src/markdown/frontmatter.ts");
const {
	hashString,
} = await jiti.import("../src/utils/hash.ts");
const {
	buildEstimatedUsage,
	estimateTokens,
	usageFromApi,
} = await jiti.import("../src/llm/token-usage.ts");
const {
	consumeSseFrames,
	extractSseData,
} = await jiti.import("../src/llm/sse.ts");

test("splits and rebuilds frontmatter", () => {
	const parts = splitFrontmatter("---\ntitle: Test\ntags:\n  - clippings\n---\n# Body\n");

	assert.equal(parts.frontmatterText, "title: Test\ntags:\n  - clippings");
	assert.equal(parts.body, "# Body\n");
	assert.equal(buildMarkdownWithFrontmatter("title: Test", "# Body"), "---\ntitle: Test\n---\n# Body\n");
});

test("normalizes and merges tags", () => {
	assert.equal(normalizeTag("#Efficient Market Hypothesis"), "efficient-market-hypothesis");
	assert.deepEqual(normalizeTags(["Finance", "finance", "Market/Efficiency", "中文"]), ["finance", "market-efficiency"]);
	assert.deepEqual(mergeTags(["clippings", "Finance"], ["finance", "market-efficiency", "asset-pricing"]), [
		"asset-pricing",
		"clippings",
		"finance",
		"market-efficiency",
	]);
});

test("strips common Wikipedia markdown noise", () => {
	const cleaned = stripWikipediaNoise([
		"[Asset](https://example.com \"Asset\") price ${\\displaystyle P_t}$.",
		"",
		"[^1]: Reference should be removed.",
		"[^2]: Another reference.",
	].join("\n"));

	assert.equal(cleaned, "[Asset](https://example.com) price ${P_t}$.");
});

test("detects whether web clippings need bilingual output", () => {
	assert.equal(detectWebClipperLanguageMode([
		"市场效率是金融经济学中的核心概念。",
		"这篇文章主要讨论价格、信息和套利之间的关系。",
		"它也提到 Eugene Fama 和 behavioral finance。",
	].join("\n")), "chinese-cleanup");

	assert.equal(detectWebClipperLanguageMode([
		"Market efficiency is a core idea in financial economics.",
		"It studies prices, information, and arbitrage.",
		"这只是一个短中文说明。",
	].join("\n")), "bilingual");
});

test("builds language-specific web clipper prompts", () => {
	const chinesePrompt = buildWebClipperPrompt({
		filePath: "Learning/Clippings/中文.md",
		frontmatter: {},
		body: "这是一篇中文文章，主要讨论市场、价格、信息和套利。这里还有足够多的中文内容用于判断。",
		taskPrompt: "",
	});
	assert.match(chinesePrompt, /Detected language mode: chinese-cleanup/u);
	assert.match(chinesePrompt, /Do not create English\/Chinese paired paragraphs/u);

	const englishPrompt = buildWebClipperPrompt({
		filePath: "Learning/Clippings/English.md",
		frontmatter: {},
		body: "This is an English article about markets, prices, information, arbitrage, and asset pricing.",
		taskPrompt: "",
	});
	assert.match(englishPrompt, /Detected language mode: bilingual/u);
	assert.match(englishPrompt, /followed immediately by a faithful Chinese paragraph/u);
});

test("parses and validates LLM JSON output", () => {
	const result = parseWebClipperLlmResult(JSON.stringify({
		markdown: [
			"# Efficient-market hypothesis / 有效市场假说",
			"",
			"Prices reflect available information.",
			"",
			"价格反映了可获得的信息。",
		].join("\n"),
		tags: ["Finance", "Market Efficiency", "Asset Pricing"],
	}));

	assert.equal(result.markdown.includes("\\displaystyle"), false);
	assert.deepEqual(result.tags, ["finance", "market-efficiency", "asset-pricing"]);
});

test("rejects invalid LLM output before writeback", () => {
	assert.throws(() => parseWebClipperLlmResult(JSON.stringify({
		markdown: "```markdown\n# Bad\n```",
		tags: ["one", "two", "three"],
	})), /code fence/u);

	const cleaned = parseWebClipperLlmResult(JSON.stringify({
		markdown: "Text with \\displaystyle still present.",
		tags: ["one", "two", "three"],
	}));
	assert.equal(cleaned.markdown, "Text with still present.");
});

test("hash detects changed source text", () => {
	assert.equal(hashString("original") === hashString("changed"), false);
	assert.equal(hashString("original"), hashString("original"));
});

test("estimates and normalizes token usage", () => {
	assert.equal(estimateTokens(""), 0);
	assert.equal(estimateTokens("market efficiency"), 4);
	assert.deepEqual(buildEstimatedUsage(10, "market efficiency"), {
		inputTokens: 10,
		outputTokens: 4,
		totalTokens: 14,
		inputTokensEstimated: true,
		outputTokensEstimated: true,
	});
	assert.deepEqual(usageFromApi({ input_tokens: 12, output_tokens: 3, total_tokens: 15 }), {
		inputTokens: 12,
		outputTokens: 3,
		totalTokens: 15,
		inputTokensEstimated: false,
		outputTokensEstimated: false,
	});
});

test("parses server-sent event frames", () => {
	const consumed = consumeSseFrames("event: message\ndata: {\"delta\":\"hi\"}\n\npartial");

	assert.deepEqual(consumed.frames, ["event: message\ndata: {\"delta\":\"hi\"}"]);
	assert.equal(consumed.rest, "partial");
	assert.equal(extractSseData(consumed.frames[0]), "{\"delta\":\"hi\"}");
});
