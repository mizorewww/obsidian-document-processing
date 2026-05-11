import type { App, TAbstractFile, TFile } from "obsidian";
import { parseYaml } from "obsidian";
import { splitFrontmatter } from "../markdown/frontmatter";
import { DocumentProcessingSettings } from "../settings-data";
import { hashString } from "../utils/hash";
import {
	createQueueKey,
	findTaskBindingForFile,
	shouldAutoProcessTask,
	TaskBinding,
} from "./bindings";
import { ProcessingResult, TaskDefinition } from "./types";
import { DEFAULT_PROCESSING_TASK_ID, ProcessingTaskId } from "./task-ids";

export type TaskRunSource = "manual" | "auto";

export interface AutoQueueState {
	pendingCount: number;
	activeFilePath: string | null;
}

interface AutoProcessorOptions {
	app: App;
	getSettings: () => DocumentProcessingSettings;
	getTaskDefinition: (taskId: ProcessingTaskId) => Pick<TaskDefinition, "processedFrontmatterKey">;
	runTask: (file: TFile, binding: TaskBinding | null, source: TaskRunSource, pendingCount: number, taskId?: ProcessingTaskId, signal?: AbortSignal) => Promise<ProcessingResult>;
	onQueueChange: (state: AutoQueueState) => void;
	onAutoFailure: (file: TFile, error: unknown) => void;
}

interface QueueItem {
	file: TFile;
	binding: TaskBinding | null;
	source: TaskRunSource;
	key: string;
	abortController: AbortController;
	taskId?: ProcessingTaskId;
	resolve?: (result: ProcessingResult) => void;
	reject?: (error: unknown) => void;
}

interface Candidate {
	binding: TaskBinding;
	hash: string;
}

export class AutoProcessDedupeTracker {
	private queuedKeys = new Set<string>();

	canQueue(key: string): boolean {
		return !this.queuedKeys.has(key);
	}

	markQueued(key: string): void {
		this.queuedKeys.add(key);
	}

	markDequeued(key: string): void {
		this.queuedKeys.delete(key);
	}
}

export class ProcessingCanceledError extends Error {
	constructor(message = "Processing queue canceled.") {
		super(message);
		this.name = "ProcessingCanceledError";
	}
}

export class AutoProcessor {
	private app: App;
	private getSettings: () => DocumentProcessingSettings;
	private getTaskDefinition: AutoProcessorOptions["getTaskDefinition"];
	private runTask: AutoProcessorOptions["runTask"];
	private onQueueChange: AutoProcessorOptions["onQueueChange"];
	private onAutoFailure: AutoProcessorOptions["onAutoFailure"];
	private queue: QueueItem[] = [];
	private dedupe = new AutoProcessDedupeTracker();
	private processing = false;
	private activeFilePath: string | null = null;
	private activeAbortController: AbortController | null = null;
	private modifyTimers = new Map<string, number>();

	constructor(options: AutoProcessorOptions) {
		this.app = options.app;
		this.getSettings = options.getSettings;
		this.getTaskDefinition = options.getTaskDefinition;
		this.runTask = options.runTask;
		this.onQueueChange = options.onQueueChange;
		this.onAutoFailure = options.onAutoFailure;
	}

	async scanAll(): Promise<void> {
		for (const file of this.app.vault.getMarkdownFiles()) {
			await this.enqueueAutoCandidates(file);
		}
	}

	async handleCreate(file: TAbstractFile): Promise<void> {
		if (isMarkdownFile(file)) {
			await this.enqueueAutoCandidates(file);
		}
	}

	async handleRename(file: TAbstractFile): Promise<void> {
		if (isMarkdownFile(file)) {
			await this.enqueueAutoCandidates(file);
		}
	}

	handleModify(file: TAbstractFile): void {
		if (!isMarkdownFile(file)) {
			return;
		}

		const existingTimer = this.modifyTimers.get(file.path);
		if (existingTimer !== undefined) {
			window.clearTimeout(existingTimer);
		}

		const timer = window.setTimeout(() => {
			this.modifyTimers.delete(file.path);
			void this.enqueueAutoCandidates(file);
		}, 1500);
		this.modifyTimers.set(file.path, timer);
	}

	enqueueManual(file: TFile, binding: TaskBinding | null, taskId?: ProcessingTaskId): Promise<ProcessingResult> {
		return new Promise((resolve, reject) => {
			const manualTaskId = taskId ?? binding?.taskId;
			const key = `manual:${file.path}:${manualTaskId ?? "default"}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
			const abortController = new AbortController();
			this.queue.push({
				file,
				binding,
				source: "manual",
				key,
				taskId,
				abortController,
				resolve,
				reject,
			});
			this.dedupe.markQueued(key);
			this.notifyQueueChange();
			void this.processQueue();
		});
	}

	private async enqueueAutoCandidates(file: TFile): Promise<void> {
		const candidates = await this.getAutoCandidates(file);
		if (candidates.length === 0) {
			return;
		}

		for (const candidate of candidates) {
			const key = createQueueKey(file.path, candidate.hash, candidate.binding.taskId);
			if (!this.dedupe.canQueue(key)) {
				continue;
			}

			this.queue.push({
				file,
				binding: candidate.binding,
				source: "auto",
				key,
				abortController: new AbortController(),
			});
			this.dedupe.markQueued(key);
		}
		this.notifyQueueChange();
		void this.processQueue();
	}

	private async getAutoCandidates(file: TFile): Promise<Candidate[]> {
		const settings = this.getSettings();
		const bindings = this.getAutoBindingsByTask(file.path, settings.taskBindings.filter((item) => item.autoProcess));
		if (bindings.length === 0) {
			return [];
		}

		const markdown = await this.app.vault.cachedRead(file);
		const frontmatter = parseFrontmatterFromMarkdown(markdown);
		const hash = hashString(markdown);

		return bindings
			.filter((binding) => shouldAutoProcessTask(frontmatter, this.getTaskDefinition(binding.taskId)))
			.map((binding) => ({
				binding,
				hash,
			}));
	}

	private getAutoBindingsByTask(filePath: string, bindings: TaskBinding[]): TaskBinding[] {
		const taskIds = Array.from(new Set(bindings.map((binding) => binding.taskId)))
			.sort((left, right) => getTaskRunOrder(left) - getTaskRunOrder(right));
		return taskIds
			.map((taskId) => findTaskBindingForFile(filePath, bindings.filter((binding) => binding.taskId === taskId)))
			.filter((binding): binding is TaskBinding => binding !== null);
	}

	private async processQueue(): Promise<void> {
		if (this.processing) {
			return;
		}

		this.processing = true;
		try {
			while (this.queue.length > 0) {
				const item = this.queue.shift();
				if (!item) {
					continue;
				}

				this.dedupe.markDequeued(item.key);
				this.activeFilePath = item.file.path;
				this.activeAbortController = item.abortController;
				this.notifyQueueChange();

				try {
					if (item.abortController.signal.aborted) {
						throw new ProcessingCanceledError();
					}

					if (item.source === "auto" && !await this.isStillAutoCandidate(item)) {
						continue;
					}

					const result = await this.runTask(item.file, item.binding, item.source, this.queue.length, item.taskId, item.abortController.signal);
					item.resolve?.(result);
				} catch (error) {
					if (item.source === "auto") {
						this.onAutoFailure(item.file, error);
					}
					item.reject?.(error);
				} finally {
					this.activeFilePath = null;
					this.activeAbortController = null;
					this.notifyQueueChange();
				}
			}
		} finally {
			this.processing = false;
			this.activeFilePath = null;
			this.activeAbortController = null;
			this.notifyQueueChange();
		}
	}

	cancelAll(): number {
		let canceledCount = 0;
		const error = new ProcessingCanceledError();

		for (const timer of this.modifyTimers.values()) {
			window.clearTimeout(timer);
		}
		this.modifyTimers.clear();

		for (const item of this.queue.splice(0)) {
			item.abortController.abort();
			this.dedupe.markDequeued(item.key);
			item.reject?.(error);
			canceledCount += 1;
		}

		if (this.activeAbortController && !this.activeAbortController.signal.aborted) {
			this.activeAbortController.abort();
			canceledCount += 1;
		}

		this.notifyQueueChange();
		return canceledCount;
	}

	private async isStillAutoCandidate(item: QueueItem): Promise<boolean> {
		if (!item.binding) {
			return false;
		}

		const candidates = await this.getAutoCandidates(item.file);
		return candidates.some((candidate) => candidate.binding.id === item.binding?.id);
	}

	private notifyQueueChange(): void {
		this.onQueueChange({
			pendingCount: this.queue.length,
			activeFilePath: this.activeFilePath,
		});
	}
}

export function parseFrontmatterFromMarkdown(markdown: string): Record<string, unknown> {
	const parts = splitFrontmatter(markdown);
	if (!parts.frontmatterText) {
		return {};
	}

	try {
		const parsed: unknown = parseYaml(parts.frontmatterText);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: {};
	} catch {
		return {};
	}
}

function isMarkdownFile(file: TAbstractFile): file is TFile {
	return "extension" in file && file.extension === "md";
}

function getTaskRunOrder(taskId: ProcessingTaskId): number {
	if (taskId === DEFAULT_PROCESSING_TASK_ID) {
		return 0;
	}

	return 10;
}
