import { App, normalizePath, parseYaml, PluginManifest, stringifyYaml, TFile } from "obsidian";
import { splitFrontmatter } from "../markdown/frontmatter";
import { requestLlmText } from "../llm/request";
import { LlmProgressCallback } from "../llm/token-usage";
import { DocumentProcessingSettings } from "../settings-data";
import { hashString } from "../utils/hash";
import { getTaskPrompt, TaskBinding } from "./bindings";
import { ProcessingJob, ProcessingResult, TaskDefinition, TaskInput, TaskReference } from "./types";

interface TaskRunnerOptions {
	app: App;
	manifest: PluginManifest;
	settings: DocumentProcessingSettings;
	saveSettings: () => Promise<void>;
	onLlmProgress?: LlmProgressCallback;
}

interface TaskRunOptions {
	binding?: TaskBinding | null;
	promptOverride?: string;
}

export class TaskRunner {
	private app: App;
	private manifest: PluginManifest;
	private settings: DocumentProcessingSettings;
	private saveSettings: () => Promise<void>;
	private onLlmProgress?: LlmProgressCallback;

	constructor(options: TaskRunnerOptions) {
		this.app = options.app;
		this.manifest = options.manifest;
		this.settings = options.settings;
		this.saveSettings = options.saveSettings;
		this.onLlmProgress = options.onLlmProgress;
	}

	async run(task: TaskDefinition, file: TFile, options: TaskRunOptions = {}): Promise<ProcessingResult> {
		if (file.extension !== "md") {
			throw new Error("Only Markdown files can be processed.");
		}

		const originalMarkdown = await this.app.vault.read(file);
		const originalHash = hashString(originalMarkdown);
		const job = this.createJob(task, file, originalHash);

		await this.ensureDir(job.cachePath);
		await this.writeManifest(job);
		await this.writeText(job, "original.md", originalMarkdown);

		try {
			job.status = "running";
			await this.writeManifest(job);

			const taskInput = this.buildTaskInput(file, originalMarkdown, originalHash);
			const prompt = options.promptOverride?.trim() || getTaskPrompt(task, options.binding ?? null);
			const references = this.loadTaskReferences(task);
			const preparedRequest = task.prepare(taskInput, { prompt, references, settings: this.settings });
			const llmResponse = await requestLlmText({
				settings: this.settings,
				saveSettings: this.saveSettings,
				instructions: preparedRequest.instructions,
				prompt: preparedRequest.prompt,
				maxOutputTokens: preparedRequest.maxOutputTokens,
				onProgress: this.onLlmProgress,
			});
			job.provider = llmResponse.provider;
			job.model = llmResponse.model;
			job.tokenUsage = llmResponse.usage;
			await this.writeJson(job, "llm-output.json", {
				rawText: llmResponse.text,
				usage: llmResponse.usage,
			});

			const taskOutput = task.buildOutput(taskInput, llmResponse.text, stringifyFrontmatter);
			await this.writeJson(job, "llm-output.json", {
				rawText: llmResponse.text,
				parsedOutput: taskOutput.parsedOutput,
				usage: llmResponse.usage,
			});
			await this.writeText(job, "final.md", taskOutput.finalMarkdown);

			job.status = "cached";
			await this.writeManifest(job);

			await this.commitIfUnchanged(file, originalHash, taskOutput.finalMarkdown);

			job.status = "committed";
			job.finishedAt = new Date().toISOString();
			await this.safeWriteManifest(job);
			await this.pruneOldJobs();

			return {
				job,
				generatedTags: taskOutput.generatedTags,
				tokenUsage: llmResponse.usage,
			};
		} catch (error) {
			job.status = "failed";
			job.finishedAt = new Date().toISOString();
			job.error = error instanceof Error ? error.message : String(error);
			await this.safeWriteText(job, "error.txt", job.error);
			await this.safeWriteManifest(job);
			await this.pruneOldJobs();
			throw error;
		}
	}

	private buildTaskInput(file: TFile, originalMarkdown: string, originalHash: string): TaskInput {
		const parts = splitFrontmatter(originalMarkdown);
		return {
			filePath: file.path,
			originalMarkdown,
			originalHash,
			frontmatter: parseFrontmatter(parts.frontmatterText),
			body: parts.body,
		};
	}

	private createJob(task: TaskDefinition, file: TFile, originalHash: string): ProcessingJob {
		const jobId = createJobId();
		return {
			id: jobId,
			taskId: task.id,
			taskName: task.name,
			filePath: file.path,
			cachePath: normalizePath(`${this.getCacheRoot()}/${jobId}`),
			provider: this.settings.llmProvider,
			model: this.getCurrentModel(),
			originalHash,
			startedAt: new Date().toISOString(),
			status: "created",
		};
	}

	private getCurrentModel(): string {
		return this.settings.llmProvider === "codex-login"
			? this.settings.codexModel
			: this.settings.openaiModel;
	}

	private async commitIfUnchanged(file: TFile, originalHash: string, finalMarkdown: string): Promise<void> {
		await this.app.vault.process(file, (currentMarkdown) => {
			if (hashString(currentMarkdown) !== originalHash) {
				throw new Error("The note changed while processing. Original file was not modified.");
			}

			return finalMarkdown;
		});
	}

	private async writeManifest(job: ProcessingJob): Promise<void> {
		await this.writeJson(job, "manifest.json", job);
	}

	private async safeWriteManifest(job: ProcessingJob): Promise<void> {
		try {
			await this.writeManifest(job);
		} catch (error) {
			console.error("Document Processing could not write job manifest", error);
		}
	}

	private async writeJson(job: ProcessingJob, fileName: string, data: unknown): Promise<void> {
		await this.writeText(job, fileName, `${JSON.stringify(data, null, "\t")}\n`);
	}

	private async writeText(job: ProcessingJob, fileName: string, data: string): Promise<void> {
		await this.app.vault.adapter.write(normalizePath(`${job.cachePath}/${fileName}`), data);
	}

	private async safeWriteText(job: ProcessingJob, fileName: string, data: string): Promise<void> {
		try {
			await this.writeText(job, fileName, data);
		} catch (error) {
			console.error("Document Processing could not write job cache", error);
		}
	}

	private getCacheRoot(): string {
		const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		return normalizePath(`${pluginDir}/cache`);
	}

	private loadTaskReferences(task: TaskDefinition): TaskReference[] {
		return (task.referencePromptFiles ?? []).map((reference) => ({
			path: reference.path,
			content: reference.content,
		}));
	}

	private async ensureDir(path: string): Promise<void> {
		const parts = normalizePath(path).split("/");
		let current = "";

		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!await this.app.vault.adapter.exists(current)) {
				await this.app.vault.adapter.mkdir(current);
			}
		}
	}

	private async pruneOldJobs(): Promise<void> {
		const limit = Math.max(1, this.settings.cacheRetentionLimit);
		const cacheRoot = this.getCacheRoot();
		try {
			if (!await this.app.vault.adapter.exists(cacheRoot)) {
				return;
			}

			const listed = await this.app.vault.adapter.list(cacheRoot);
			const folders = [...listed.folders].sort((left, right) => left.localeCompare(right));
			const foldersToDelete = folders.slice(0, Math.max(0, folders.length - limit));
			for (const folder of foldersToDelete) {
				await this.app.vault.adapter.rmdir(folder, true);
			}
		} catch (error) {
			console.error("Document Processing could not prune old job caches", error);
		}
	}
}

function parseFrontmatter(frontmatterText: string | null): Record<string, unknown> {
	if (!frontmatterText) {
		return {};
	}

	const parsed: unknown = parseYaml(frontmatterText);
	if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
		return parsed as Record<string, unknown>;
	}

	return {};
}

function stringifyFrontmatter(frontmatter: Record<string, unknown>): string {
	const yaml = stringifyYaml(frontmatter).trimEnd();
	parseYaml(yaml);
	return yaml;
}

function createJobId(): string {
	const timestamp = new Date().toISOString().replace(/[-:.]/gu, "").replace("Z", "");
	const suffix = Math.random().toString(36).slice(2, 8);
	return `${timestamp}-${suffix}`;
}
