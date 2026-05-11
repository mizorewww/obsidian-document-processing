import { buildMarkdownWithFrontmatter } from "../markdown/frontmatter";
import { DEFAULT_PROCESSING_TASK_ID } from "./task-ids";
import { TaskDefinition, TaskInput, TaskOutput, TaskPrepareOptions } from "./types";
import { buildWebClipperPrompt, DEFAULT_WEB_CLIPPER_PROMPT, mergeTags, parseWebClipperLlmResult } from "./web-clipper-utils";

export const WEB_CLIPPER_BILINGUAL_CLEANUP_TASK: TaskDefinition = {
	id: DEFAULT_PROCESSING_TASK_ID,
	name: "Web clipping bilingual cleanup",
	defaultPrompt: DEFAULT_WEB_CLIPPER_PROMPT,
	processedFrontmatterKey: "llm",
	prepare(input: TaskInput, options: TaskPrepareOptions) {
		return {
			instructions: [
				"You clean Markdown web clippings for an Obsidian vault.",
				"Return only valid JSON. Do not wrap the JSON in Markdown fences.",
				"Be faithful to the source text and do not introduce unsupported claims.",
			].join(" "),
			prompt: buildWebClipperPrompt({
				filePath: input.filePath,
				frontmatter: input.frontmatter,
				body: input.body,
				taskPrompt: options.prompt,
			}),
			maxOutputTokens: 16000,
		};
	},
	buildOutput(input: TaskInput, rawLlmText: string, stringifyFrontmatter: (frontmatter: Record<string, unknown>) => string): TaskOutput {
		const parsedOutput = parseWebClipperLlmResult(rawLlmText);
		const nextFrontmatter = {
			...input.frontmatter,
			tags: mergeTags(input.frontmatter.tags, parsedOutput.tags),
			llm: true,
		};
		const frontmatterYaml = stringifyFrontmatter(nextFrontmatter);

		return {
			finalMarkdown: buildMarkdownWithFrontmatter(frontmatterYaml, parsedOutput.markdown),
			parsedOutput,
			generatedTags: parsedOutput.tags,
		};
	},
};
