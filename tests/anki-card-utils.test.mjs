import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
	buildAnkiCardPrompt,
	extractAnkiCardUuids,
	normalizeAnkiCardLanguage,
	parseAnkiCardLlmResult,
	replaceOrAppendAnkiCardsSection,
} = await jiti.import("../src/tasks/anki-card-utils.ts");

const existingUuid = "11111111-1111-4111-8111-111111111111";

test("puts the selected card language at the top of the prompt", () => {
	const prompt = buildAnkiCardPrompt({
		filePath: "Note.md",
		frontmatter: {},
		body: "# Note\n\nEnglish source text.",
		taskPrompt: "",
		references: [],
		cardLanguage: "zh-CN",
	});

	assert.match(prompt.split("\n").slice(0, 5).join("\n"), /Simplified Chinese/u);
	assert.match(prompt, /Do not default to English/u);
	assert.match(prompt, /Prefer cloze\/fill-in cards over Basic question-answer cards/u);
	assert.match(prompt, /one context-rich Cloze note with multiple blanks/u);
	assert.equal(normalizeAnkiCardLanguage("bad-value"), "zh-CN");
});

test("adds user revision instructions and current-file git diff when cards already exist", () => {
	const prompt = buildAnkiCardPrompt({
		filePath: "Learning/Note.md",
		frontmatter: { anki: false },
		body: [
			"# Note",
			"",
			"Current note text.",
			"",
			"# Cards",
			"",
			"## Old card",
			"{{c1::old}}",
		].join("\n"),
		taskPrompt: "",
		references: [],
		cardLanguage: "zh-CN",
		revisionInstructions: "把旧卡合并成更完整的填空卡。",
		currentFileGitDiff: [
			"diff --git a/Learning/Note.md b/Learning/Note.md",
			"@@ -1,3 +1,4 @@",
			"+New source sentence.",
		].join("\n"),
	});

	assert.match(prompt, /Card revision context/u);
	assert.match(prompt, /把旧卡合并成更完整的填空卡/u);
	assert.match(prompt, /HEAD -> working tree/u);
	assert.match(prompt, /this exact opened note/u);
	assert.match(prompt, /\+New source sentence/u);
});

test("parses Anki card JSON with new cards and preserved existing UUIDs", () => {
	const raw = JSON.stringify({
		cardsMarkdown: [
			"# Cards",
			"",
			"## Existing concept",
			"The answer is {{c1::stable}}.",
			`uuid: ${existingUuid}`,
			"---",
			"",
			"Front",
			"",
			"## New basic card",
			"What does the concept test?",
			"",
			"Back",
			"",
			"One precise idea.",
			"tags: anki basic",
			"---",
		].join("\n"),
		changeSummary: ["updated one card", "added one card"],
	});

	const result = parseAnkiCardLlmResult(raw, { existingUuids: new Set([existingUuid]) });

	assert.match(result.cardsMarkdown, /^# Cards/u);
	assert.deepEqual(result.changeSummary, ["updated one card", "added one card"]);
	assert.deepEqual(extractAnkiCardUuids(result.cardsMarkdown), [existingUuid]);
});

test("sanitizes fabricated UUIDs and non-empty paths instead of failing", () => {
	const fabricatedUuidResult = parseAnkiCardLlmResult(JSON.stringify({
		cardsMarkdown: [
			"# Cards",
			"",
			"## Fake identity",
			"{{c1::answer}}",
			"uuid: 22222222-2222-4222-8222-222222222222",
		].join("\n"),
	}), { existingUuids: new Set([existingUuid]) });

	assert.match(fabricatedUuidResult.cardsMarkdown, /^uuid:\s*$/mu);
	assert.doesNotMatch(fabricatedUuidResult.cardsMarkdown, /22222222/u);

	const pathResult = parseAnkiCardLlmResult(JSON.stringify({
		cardsMarkdown: [
			"# Cards",
			"",
			"## Bad path",
			"{{c1::answer}}",
			"path: folder/page.md",
		].join("\n"),
	}), { existingUuids: new Set() });

	assert.match(pathResult.cardsMarkdown, /^path:\s*$/mu);
	assert.doesNotMatch(pathResult.cardsMarkdown, /folder\/page\.md/u);
});

test("rejects Basic-style cards that contain cloze syntax", () => {
	assert.throws(() => parseAnkiCardLlmResult(JSON.stringify({
		cardsMarkdown: [
			"# Cards",
			"",
			"type: basic",
			"Front",
			"Question",
			"Back",
			"{{c1::answer}}",
		].join("\n"),
	}), { existingUuids: new Set() }), /Basic cards/u);

	assert.throws(() => parseAnkiCardLlmResult(JSON.stringify({
		cardsMarkdown: [
			"# Cards",
			"",
			"Front",
			"Question with {{c1::answer}}",
			"Back",
			"Answer",
		].join("\n"),
	}), { existingUuids: new Set() }), /Basic-style cards/u);
});

test("replaces an existing # Cards section while preserving note body", () => {
	const body = [
		"# Article",
		"",
		"Source material.",
		"",
		"# Cards",
		"",
		"## Old card",
		"{{c1::old}}",
	].join("\n");
	const cards = [
		"# Cards",
		"",
		"## New card",
		"{{c1::new}}",
	].join("\n");

	assert.equal(replaceOrAppendAnkiCardsSection(body, cards), [
		"# Article",
		"",
		"Source material.",
		"",
		"# Cards",
		"",
		"## New card",
		"{{c1::new}}",
		"",
	].join("\n"));
});

test("appends a # Cards section when none exists", () => {
	const body = "# Article\n\nSource material.\n";
	const cards = "# Cards\n\n## New card\n{{c1::new}}";

	assert.equal(replaceOrAppendAnkiCardsSection(body, cards), [
		"# Article",
		"",
		"Source material.",
		"",
		"# Cards",
		"",
		"## New card",
		"{{c1::new}}",
		"",
	].join("\n"));
});
