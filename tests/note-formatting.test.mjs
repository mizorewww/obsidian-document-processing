import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
	buildNoteFormattingPrompt,
	parseNoteFormattingLlmResult,
} = await jiti.import("../src/tasks/note-formatting.ts");

test("builds a prompt that protects Obsidian syntax and frontmatter", () => {
	const prompt = buildNoteFormattingPrompt({
		filePath: "Notes/排版.md",
		frontmatter: { tags: ["writing"], formatted: false },
		body: [
			"# 标题",
			"",
			"使用Obsidian写第3章，参考[[Page#Heading|别名]]和#AI。",
			"",
			"```",
			"const url = \"https://example.com?a=1&b=2\";",
			"```",
		].join("\n"),
		taskPrompt: "",
	});

	assert.match(prompt, /Do not include YAML frontmatter/u);
	assert.match(prompt, /\[\[wikilinks\]\]/u);
	assert.match(prompt, /Do not hard-wrap paragraphs/u);
	assert.match(prompt, /使用Obsidian写第3章/u);
});

test("parses formatted note JSON and unwraps only markdown wrapper fences", () => {
	const result = parseNoteFormattingLlmResult(JSON.stringify({
		markdown: [
			"```markdown",
			"# 标题",
			"",
			"使用 Obsidian 写第 3 章。",
			"```",
		].join("\n"),
		changeSummary: ["补中英空格", "补数字空格"],
	}));

	assert.equal(result.markdown, "# 标题\n\n使用 Obsidian 写第 3 章。");
	assert.deepEqual(result.changeSummary, ["补中英空格", "补数字空格"]);
});

test("rejects formatted note output that includes frontmatter", () => {
	assert.throws(() => parseNoteFormattingLlmResult(JSON.stringify({
		markdown: "---\ntitle: Bad\n---\n# Body",
		changeSummary: [],
	})), /frontmatter/u);
});
