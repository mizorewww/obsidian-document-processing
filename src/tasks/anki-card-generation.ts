import { buildMarkdownWithFrontmatter } from "../markdown/frontmatter";
import { ANKI_REFERENCE_PROMPT_FILES } from "./anki-reference-prompts";
import {
	ANKI_CARD_GENERATION_TASK_ID,
	buildAnkiCardPrompt,
	DEFAULT_ANKI_CARD_PROMPT,
	extractAnkiCardUuids,
	findAnkiCardsSection,
	normalizeAnkiCardLanguage,
	parseAnkiCardLlmResult,
	replaceOrAppendAnkiCardsSection,
} from "./anki-card-utils";
import { TaskDefinition, TaskInput, TaskOutput, TaskPrepareOptions } from "./types";

export const ANKI_CARD_GENERATION_TASK: TaskDefinition = {
	id: ANKI_CARD_GENERATION_TASK_ID,
	name: "Anki card generation",
	defaultPrompt: DEFAULT_ANKI_CARD_PROMPT,
	processedFrontmatterKey: "anki",
	referencePromptFiles: ANKI_REFERENCE_PROMPT_FILES,
	prepare(input: TaskInput, options: TaskPrepareOptions) {
		return {
			instructions: [
				"You generate Anki cards for an Obsidian note.",
				"Return only valid JSON. Do not wrap the JSON in Markdown fences.",
				"Follow the provided Obsidian Anki Sync rules exactly.",
				"Never invent UUIDs or paths.",
			].join(" "),
			prompt: buildAnkiCardPrompt({
				filePath: input.filePath,
				frontmatter: input.frontmatter,
				body: input.body,
				taskPrompt: options.prompt,
				references: options.references,
				cardLanguage: normalizeAnkiCardLanguage(options.settings.ankiCardLanguage),
				revisionInstructions: options.context?.ankiRevisionInstructions,
				currentFileGitDiff: options.context?.currentFileGitDiff,
				gitDiffUnavailableReason: options.context?.gitDiffUnavailableReason,
			}),
			maxOutputTokens: 20000,
		};
	},
	buildOutput(input: TaskInput, rawLlmText: string, stringifyFrontmatter: (frontmatter: Record<string, unknown>) => string): TaskOutput {
		const existingCards = findAnkiCardsSection(input.body)?.sectionMarkdown ?? "";
		const existingUuids = new Set(extractAnkiCardUuids(existingCards));
		const parsedOutput = parseAnkiCardLlmResult(rawLlmText, { existingUuids });
		const nextFrontmatter = {
			...input.frontmatter,
			anki: true,
		};
		const frontmatterYaml = stringifyFrontmatter(nextFrontmatter);
		const nextBody = replaceOrAppendAnkiCardsSection(input.body, parsedOutput.cardsMarkdown);

		return {
			finalMarkdown: buildMarkdownWithFrontmatter(frontmatterYaml, nextBody),
			parsedOutput,
			generatedTags: [],
		};
	},
};
