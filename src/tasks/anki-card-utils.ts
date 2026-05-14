import { TaskReference } from "./types";
import type { AnkiCardLanguage } from "../settings-data";

export interface AnkiCardLlmResult {
	cardsMarkdown: string;
	changeSummary: string[];
}

export interface AnkiCardsSection {
	startOffset: number;
	contentStartOffset: number;
	endOffset: number;
	sectionMarkdown: string;
}

export interface BuildAnkiCardPromptInput {
	filePath: string;
	frontmatter: Record<string, unknown>;
	body: string;
	taskPrompt: string;
	references: TaskReference[];
	cardLanguage: AnkiCardLanguage;
	revisionInstructions?: string;
	currentFileGitDiff?: string;
	gitDiffUnavailableReason?: string;
}

export interface ParseAnkiCardLlmResultOptions {
	existingUuids: Set<string>;
}

export const ANKI_CARD_GENERATION_TASK_ID = "anki-card-generation";

export const DEFAULT_ANKI_CARD_PROMPT = [
	"You create and maintain Anki cards inside Obsidian Markdown notes.",
	"Use the supplied Anki Sync rules, card-writing guide, examples, and output contract.",
	"Generate a complete # Cards section that can replace the note's existing # Cards section.",
	"You may add, delete, or revise cards based on the current note content and existing card quality.",
	"Base every card on the note. Do not add unsupported facts.",
	"Prefer cloze/fill-in cards over Basic question-answer cards.",
	"When related facts share one complete context, create one context-rich Cloze note with multiple blanks such as c1, c2, and c3 instead of many tiny fragmented notes.",
	"If keeping or editing an existing card, preserve its uuid exactly.",
	"For new cards, omit uuid or leave uuid blank. Never invent uuid values.",
	"Never write a non-empty path line. If an existing card has path, remove it or leave path blank. The Anki Sync plugin owns path.",
].join("\n");

const CARDS_HEADING_PATTERN = /^#{1,6}\s+Cards\s*$/imu;
const BLOCK_SEPARATOR_PATTERN = /^\s*---\s*$/u;
const METADATA_LINE_PATTERN = /^\s*(type|tag|tags|uuid|path)\s*:\s*(.*?)\s*$/iu;
const CLOZE_PATTERN = /\{\{c\d+::[\s\S]*?\}\}/iu;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BASIC_TYPES = new Set([
	"basic",
	"basic-reversed",
	"basic-type",
	"basic-modern",
	"basic-modern-reversed",
	"basic-modern-typing",
]);
const SUPPORTED_TYPES = new Set([
	"cloze",
	"cloze-type",
	"basic",
	"basic-reversed",
	"basic-type",
	"cloze-modern",
	"cloze-modern-typing",
	"basic-modern",
	"basic-modern-reversed",
	"basic-modern-typing",
]);

export function buildAnkiCardPrompt(input: BuildAnkiCardPromptInput): string {
	const existingCards = findAnkiCardsSection(input.body)?.sectionMarkdown ?? "";
	const existingUuids = extractAnkiCardUuids(existingCards);
	const references = formatReferences(input.references);
	const revisionContext = formatRevisionContext(input, existingCards);

	return [
		getCardLanguageInstruction(input.cardLanguage),
		"",
		input.taskPrompt.trim() || DEFAULT_ANKI_CARD_PROMPT,
		"",
		references,
		"",
		"Current note:",
		`File path: ${input.filePath}`,
		`Existing metadata: ${JSON.stringify(input.frontmatter)}`,
		`Existing card UUIDs that may be preserved: ${existingUuids.length > 0 ? existingUuids.join(", ") : "(none)"}`,
		"",
		revisionContext,
		"",
		"Existing # Cards section, if any:",
		existingCards || "(none)",
		"",
		"Source note markdown without YAML frontmatter:",
		input.body.trim(),
	].join("\n");
}

function formatRevisionContext(input: BuildAnkiCardPromptInput, existingCards: string): string {
	if (!existingCards.trim()) {
		return "Card revision context: no existing # Cards section was found, so create cards from the current note.";
	}

	const instructions = input.revisionInstructions?.trim();
	const diff = input.currentFileGitDiff?.trim();
	const diffStatus = diff
		? [
			"Current-file Git diff, HEAD -> working tree, for this opened note only:",
			"```diff",
			diff,
			"```",
		].join("\n")
		: `Current-file Git diff: ${input.gitDiffUnavailableReason?.trim() || "No uncommitted diff for this file."}`;

	return [
		"Card revision context:",
		"An existing # Cards section was found. Treat this as a card update task, not a blind regeneration task.",
		"Use the current note as the source of truth. Use the user instruction and Git diff below as signals for what changed and how cards should be revised.",
		"The Git diff is the uncommitted working-tree diff for this exact opened note versus the committed version at HEAD. It is not a comparison between recent commits.",
		"",
		"User instruction for revising cards:",
		instructions || "(none)",
		"",
		diffStatus,
	].join("\n");
}

export function normalizeAnkiCardLanguage(value: unknown): AnkiCardLanguage {
	if (value === "en" || value === "match-note") {
		return value;
	}

	return "zh-CN";
}

export function parseAnkiCardLlmResult(rawText: string, options: ParseAnkiCardLlmResultOptions): AnkiCardLlmResult {
	const payload = parseJsonObject(rawText) as {
		cardsMarkdown?: unknown;
		changeSummary?: unknown;
	};

	if (typeof payload.cardsMarkdown !== "string") {
		throw new Error("LLM output is missing cardsMarkdown.");
	}

	const cardsMarkdown = normalizeCardsMarkdown(payload.cardsMarkdown);
	const sanitizedCardsMarkdown = sanitizeIdentityLines(cardsMarkdown, options.existingUuids);
	validateCardsMarkdown(sanitizedCardsMarkdown, options.existingUuids);

	return {
		cardsMarkdown: sanitizedCardsMarkdown,
		changeSummary: normalizeChangeSummary(payload.changeSummary),
	};
}

export function replaceOrAppendAnkiCardsSection(body: string, cardsMarkdown: string): string {
	const normalizedCards = normalizeCardsMarkdown(cardsMarkdown);
	const normalizedBody = body.replace(/\r\n?/gu, "\n");
	const section = findAnkiCardsSection(normalizedBody);
	const before = section ? normalizedBody.slice(0, section.startOffset).trimEnd() : normalizedBody.trimEnd();

	if (!before) {
		return `${normalizedCards}\n`;
	}

	return `${before}\n\n${normalizedCards}\n`;
}

export function findAnkiCardsSection(markdown: string): AnkiCardsSection | null {
	const normalized = markdown.replace(/\r\n?/gu, "\n");
	const match = CARDS_HEADING_PATTERN.exec(normalized);
	if (!match || match.index === undefined) {
		return null;
	}

	const headingEnd = normalized.indexOf("\n", match.index);
	const contentStartOffset = headingEnd >= 0 ? headingEnd + 1 : normalized.length;

	return {
		startOffset: match.index,
		contentStartOffset,
		endOffset: normalized.length,
		sectionMarkdown: normalized.slice(match.index).trim(),
	};
}

export function extractAnkiCardUuids(cardsMarkdown: string): string[] {
	const uuids: string[] = [];
	for (const metadata of extractMetadataLines(cardsMarkdown)) {
		if (metadata.key !== "uuid") {
			continue;
		}

		const uuid = metadata.value.trim().toLowerCase();
		if (UUID_PATTERN.test(uuid)) {
			uuids.push(uuid);
		}
	}

	return Array.from(new Set(uuids));
}

export function normalizeCardsMarkdown(cardsMarkdown: string): string {
	const normalized = cardsMarkdown.replace(/\r\n?/gu, "\n").trim();
	if (/^```[\s\S]*```$/u.test(normalized)) {
		throw new Error("Anki cards must not be wrapped in a code fence.");
	}

	return normalized.replace(/[ \t]+$/gmu, "");
}

function validateCardsMarkdown(cardsMarkdown: string, existingUuids: Set<string>): void {
	if (!cardsMarkdown) {
		throw new Error("Anki cards output is empty.");
	}

	if (cardsMarkdown.startsWith("---")) {
		throw new Error("Anki cards output must not include YAML frontmatter.");
	}

	if (!/^#\s+Cards\s*$/imu.test(cardsMarkdown.split("\n")[0] ?? "")) {
		throw new Error("Anki cards output must start with # Cards.");
	}

	const blocks = splitAnkiCardBlocks(cardsMarkdown).filter(hasCardContent);
	if (blocks.length === 0) {
		throw new Error("Anki cards output must include at least one card.");
	}

	validateIdentityLines(blocks, existingUuids);
	validateCardTypes(blocks);
}

function validateIdentityLines(blocks: string[], existingUuids: Set<string>): void {
	const outputUuids = new Set<string>();

	for (const block of blocks) {
		for (const metadata of extractMetadataLines(block)) {
			if (metadata.key === "path" && metadata.value.trim()) {
				throw new Error("Anki cards must not include non-empty path lines.");
			}

			if (metadata.key !== "uuid") {
				continue;
			}

			const uuid = metadata.value.trim().toLowerCase();
			if (!uuid) {
				continue;
			}

			if (!UUID_PATTERN.test(uuid)) {
				throw new Error("Anki cards include an invalid uuid.");
			}

			if (!existingUuids.has(uuid)) {
				throw new Error("Anki cards include a uuid that was not present in the original note.");
			}

			if (outputUuids.has(uuid)) {
				throw new Error("Anki cards include a duplicate uuid.");
			}

			outputUuids.add(uuid);
		}
	}
}

function sanitizeIdentityLines(cardsMarkdown: string, existingUuids: Set<string>): string {
	const outputUuids = new Set<string>();

	return cardsMarkdown.split("\n").map((line) => {
		const metadata = line.match(METADATA_LINE_PATTERN);
		if (!metadata) {
			return line;
		}

		const key = (metadata[1] ?? "").toLowerCase();
		const value = (metadata[2] ?? "").trim();

		if (key === "path") {
			return "path:";
		}

		if (key !== "uuid") {
			return line;
		}

		const uuid = value.toLowerCase();
		if (!uuid || !UUID_PATTERN.test(uuid) || !existingUuids.has(uuid) || outputUuids.has(uuid)) {
			return "uuid:";
		}

		outputUuids.add(uuid);
		return `uuid: ${uuid}`;
	}).join("\n");
}

function validateCardTypes(blocks: string[]): void {
	for (const block of blocks) {
		const type = getCardType(block);
		const hasCloze = CLOZE_PATTERN.test(block);
		const hasBasicMarkers = hasFrontBackMarkers(block);

		if (type && !SUPPORTED_TYPES.has(type)) {
			throw new Error(`Anki cards include unsupported type: ${type}.`);
		}

		if (hasCloze && type && BASIC_TYPES.has(type)) {
			throw new Error("Anki Basic cards must not contain cloze syntax.");
		}

		if (hasCloze && hasBasicMarkers) {
			throw new Error("Anki Basic-style cards must not contain cloze syntax.");
		}
	}
}

function splitAnkiCardBlocks(cardsMarkdown: string): string[] {
	const lines = cardsMarkdown.split("\n");
	const contentLines = lines.slice(1);
	const blocks: string[] = [];
	let current: string[] = [];

	for (const line of contentLines) {
		if (BLOCK_SEPARATOR_PATTERN.test(line)) {
			blocks.push(current.join("\n"));
			current = [];
			continue;
		}

		current.push(line);
	}

	if (current.some((line) => line.trim())) {
		blocks.push(current.join("\n"));
	}

	return blocks;
}

function hasCardContent(block: string): boolean {
	return block.split("\n").some((line) => {
		if (!line.trim()) {
			return false;
		}

		return !METADATA_LINE_PATTERN.test(line);
	});
}

function getCardType(block: string): string | null {
	for (const metadata of extractMetadataLines(block)) {
		if (metadata.key === "type") {
			const value = metadata.value.trim().toLowerCase();
			return value || null;
		}
	}

	return null;
}

function hasFrontBackMarkers(block: string): boolean {
	return /^\s*Front\s*$/imu.test(block) || /^\s*Back\s*$/imu.test(block);
}

function extractMetadataLines(markdown: string): Array<{ key: string; value: string }> {
	const metadata: Array<{ key: string; value: string }> = [];
	for (const line of markdown.split("\n")) {
		const match = line.match(METADATA_LINE_PATTERN);
		if (!match) {
			continue;
		}

		metadata.push({
			key: (match[1] ?? "").toLowerCase(),
			value: match[2] ?? "",
		});
	}

	return metadata;
}

function normalizeChangeSummary(value: unknown): string[] {
	if (typeof value === "string" && value.trim()) {
		return [value.trim()];
	}

	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		.map((item) => item.trim());
}

function formatReferences(references: TaskReference[]): string {
	if (references.length === 0) {
		return "Reference prompt files: (none)";
	}

	return [
		"Reference prompt files:",
		...references.map((reference) => [
			`--- ${reference.path} ---`,
			reference.content.trim(),
		].join("\n")),
	].join("\n\n");
}

function getCardLanguageInstruction(language: AnkiCardLanguage): string {
	if (language === "en") {
		return [
			"CRITICAL CARD LANGUAGE REQUIREMENT:",
			"Write the card titles, prompts, answers, cloze context, Extra sections, and explanations in English.",
			"Keep formulas, code, exact source quotes, proper nouns, and established technical terms unchanged when needed.",
		].join("\n");
	}

	if (language === "match-note") {
		return [
			"CRITICAL CARD LANGUAGE REQUIREMENT:",
			"Write cards in the dominant language of the source note.",
			"If the note is mixed or ambiguous, prefer Simplified Chinese for card titles, prompts, answers, cloze context, Extra sections, and explanations.",
			"Keep formulas, code, exact source quotes, proper nouns, and established technical terms unchanged when needed.",
		].join("\n");
	}

	return [
		"CRITICAL CARD LANGUAGE REQUIREMENT:",
		"Write the card titles, prompts, answers, cloze context, Extra sections, and explanations in Simplified Chinese.",
		"Do not default to English just because the source note contains English.",
		"Keep formulas, code, exact source quotes, proper nouns, and established technical terms unchanged when needed.",
	].join("\n");
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
