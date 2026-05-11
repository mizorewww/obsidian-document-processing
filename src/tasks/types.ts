import { ProcessingTaskId } from "./task-ids";
import { LlmTokenUsage } from "../llm/token-usage";

export interface PreparedTaskRequest {
	instructions: string;
	prompt: string;
	maxOutputTokens?: number;
}

export interface TaskReferenceFile {
	path: string;
	content: string;
}

export interface TaskReference {
	path: string;
	content: string;
}

export interface TaskPrepareOptions {
	prompt: string;
	references: TaskReference[];
	settings: {
		ankiCardLanguage?: unknown;
	};
}

export interface TaskInput {
	filePath: string;
	originalMarkdown: string;
	originalHash: string;
	frontmatter: Record<string, unknown>;
	body: string;
}

export interface TaskOutput {
	finalMarkdown: string;
	parsedOutput: unknown;
	generatedTags: string[];
}

export interface TaskDefinition {
	id: ProcessingTaskId;
	name: string;
	defaultPrompt: string;
	processedFrontmatterKey: string;
	referencePromptFiles?: TaskReferenceFile[];
	prepare(input: TaskInput, options: TaskPrepareOptions): PreparedTaskRequest;
	buildOutput(input: TaskInput, rawLlmText: string, stringifyFrontmatter: (frontmatter: Record<string, unknown>) => string): TaskOutput;
}

export type ProcessingJobStatus = "created" | "running" | "cached" | "committed" | "failed";

export interface ProcessingJob {
	id: string;
	taskId: ProcessingTaskId;
	taskName: string;
	filePath: string;
	cachePath: string;
	provider: string;
	model: string;
	originalHash: string;
	startedAt: string;
	finishedAt?: string;
	status: ProcessingJobStatus;
	tokenUsage?: LlmTokenUsage;
	error?: string;
}

export interface ProcessingResult {
	job: ProcessingJob;
	generatedTags: string[];
	tokenUsage?: LlmTokenUsage;
}
