import type { App, TAbstractFile, TFile } from "obsidian";
import { parseYaml } from "obsidian";
import { splitFrontmatter } from "../markdown/frontmatter";
import { DocumentProcessingSettings } from "../settings-data";
import {
	createQueueSlotKey,
	findTaskBindingForFile,
	shouldAutoProcessTask,
	TaskBinding,
} from "./bindings";
import { ProcessingResult, TaskDefinition, TaskPrepareContext } from "./types";
import { DEFAULT_PROCESSING_TASK_ID, ProcessingTaskId } from "./task-ids";

export type TaskRunSource = "manual" | "auto";

export interface AutoQueueState {
	pendingCount: number;
	activeFilePath: string | null;
}

export type QueueTaskStatus = "pending" | "running" | "canceling";

export interface QueueTaskSnapshot {
	id: string;
	filePath: string;
	taskId: ProcessingTaskId;
	taskName: string;
	source: TaskRunSource;
	status: QueueTaskStatus;
	queuedAt: number;
	startedAt: number | null;
}

export interface ProcessingQueueSnapshot {
	active: QueueTaskSnapshot | null;
	pending: QueueTaskSnapshot[];
	totalCount: number;
}

interface AutoProcessorOptions {
	app: App;
	getSettings: () => DocumentProcessingSettings;
	getTaskDefinition: (taskId: ProcessingTaskId) => Pick<TaskDefinition, "name" | "processedFrontmatterKey">;
	runTask: (file: TFile, binding: TaskBinding | null, source: TaskRunSource, pendingCount: number, taskId?: ProcessingTaskId, signal?: AbortSignal, context?: TaskPrepareContext) => Promise<ProcessingResult>;
	onQueueChange: (state: AutoQueueState) => void;
	onAutoFailure: (file: TFile, error: unknown) => void;
}

interface QueueItem {
	file: TFile;
	binding: TaskBinding | null;
	source: TaskRunSource;
	key: string;
	slotKey?: string;
	abortController: AbortController;
	taskId: ProcessingTaskId;
	queuedAt: number;
	startedAt?: number;
	context?: TaskPrepareContext;
	resolve?: (result: ProcessingResult) => void;
	reject?: (error: unknown) => void;
}

interface Candidate {
	binding: TaskBinding;
}

interface AutoEnqueueOptions {
	queueFollowUpForActive: boolean;
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
	private activeItem: QueueItem | null = null;
	private modifyTimers = new Map<string, number>();
	private disposed = false;

	constructor(options: AutoProcessorOptions) {
		this.app = options.app;
		this.getSettings = options.getSettings;
		this.getTaskDefinition = options.getTaskDefinition;
		this.runTask = options.runTask;
		this.onQueueChange = options.onQueueChange;
		this.onAutoFailure = options.onAutoFailure;
	}

	async scanAll(): Promise<void> {
		if (this.disposed) {
			return;
		}

		for (const file of this.app.vault.getMarkdownFiles()) {
			await this.enqueueAutoCandidates(file, { queueFollowUpForActive: false });
		}
	}

	async handleCreate(file: TAbstractFile): Promise<void> {
		if (this.disposed) {
			return;
		}

		if (isMarkdownFile(file)) {
			await this.enqueueAutoCandidates(file, { queueFollowUpForActive: false });
		}
	}

	async handleRename(file: TAbstractFile): Promise<void> {
		if (this.disposed) {
			return;
		}

		if (isMarkdownFile(file)) {
			await this.enqueueAutoCandidates(file, { queueFollowUpForActive: true });
		}
	}

	handleModify(file: TAbstractFile): void {
		if (this.disposed) {
			return;
		}

		if (!isMarkdownFile(file)) {
			return;
		}

		const existingTimer = this.modifyTimers.get(file.path);
		if (existingTimer !== undefined) {
			window.clearTimeout(existingTimer);
		}

		const timer = window.setTimeout(() => {
			this.modifyTimers.delete(file.path);
			void this.enqueueAutoCandidates(file, { queueFollowUpForActive: true });
		}, 1500);
		this.modifyTimers.set(file.path, timer);
	}

	enqueueManual(file: TFile, binding: TaskBinding | null, taskId?: ProcessingTaskId, context?: TaskPrepareContext): Promise<ProcessingResult> {
		if (this.disposed) {
			return Promise.reject(new ProcessingCanceledError("Processing queue is closed."));
		}

		return new Promise((resolve, reject) => {
			const manualTaskId = taskId ?? binding?.taskId ?? DEFAULT_PROCESSING_TASK_ID;
			const key = `manual:${file.path}:${manualTaskId ?? "default"}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
			const abortController = new AbortController();
			this.queue.push({
				file,
				binding,
				source: "manual",
				key,
				taskId: manualTaskId,
				queuedAt: Date.now(),
				context,
				abortController,
				resolve,
				reject,
			});
			this.dedupe.markQueued(key);
			this.notifyQueueChange();
			void this.processQueue();
		});
	}

	private async enqueueAutoCandidates(file: TFile, options: AutoEnqueueOptions): Promise<void> {
		if (this.disposed) {
			return;
		}

		const candidates = await this.getAutoCandidates(file);
		const candidateSlotKeys = new Set(candidates.map((candidate) => createQueueSlotKey(file.path, candidate.binding.taskId)));
		this.removeStalePendingAutoItems(file.path, candidateSlotKeys);

		if (candidates.length === 0) {
			this.notifyQueueChange();
			return;
		}

		for (const candidate of candidates) {
			const slotKey = createQueueSlotKey(file.path, candidate.binding.taskId);
			const pendingItem = this.findPendingAutoItem(slotKey);
			const activeItem = this.activeItem?.source === "auto" && this.activeItem.slotKey === slotKey
				? this.activeItem
				: null;

			if (pendingItem) {
				this.updateAutoQueueItem(pendingItem, file, candidate.binding);
				continue;
			}

			if (activeItem) {
				if (options.queueFollowUpForActive) {
					this.queue.push(this.createAutoQueueItem(file, candidate.binding, slotKey));
				}
				continue;
			}

			this.queue.push(this.createAutoQueueItem(file, candidate.binding, slotKey));
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

		return bindings
			.filter((binding) => shouldAutoProcessTask(frontmatter, this.getTaskDefinition(binding.taskId)))
			.map((binding) => ({
				binding,
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
		if (this.disposed || this.processing) {
			return;
		}

		this.processing = true;
		try {
			while (this.queue.length > 0) {
				const item = this.queue.shift();
				if (!item) {
					continue;
				}

				this.activeItem = item;
				item.startedAt = Date.now();
				this.notifyQueueChange();

				try {
					if (this.disposed) {
						throw new ProcessingCanceledError("Processing queue is closed.");
					}

					if (item.abortController.signal.aborted) {
						throw new ProcessingCanceledError();
					}

					if (item.source === "auto" && !await this.isStillAutoCandidate(item)) {
						continue;
					}

					const result = await this.runTask(item.file, item.binding, item.source, this.queue.length, item.taskId, item.abortController.signal, item.context);
					item.resolve?.(result);
				} catch (error) {
					if (item.source === "auto") {
						this.onAutoFailure(item.file, error);
					}
					item.reject?.(error);
				} finally {
					this.dedupe.markDequeued(item.key);
					if (this.activeItem === item) {
						this.activeItem = null;
					}
					this.notifyQueueChange();
				}
			}
		} finally {
			this.processing = false;
			this.activeItem = null;
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

		if (this.activeItem) {
			if (!this.activeItem.abortController.signal.aborted) {
				this.activeItem.abortController.abort();
			}
			this.activeItem.reject?.(error);
			canceledCount += 1;
		}

		this.notifyQueueChange();
		return canceledCount;
	}

	cancelItem(id: string): boolean {
		const pendingIndex = this.queue.findIndex((item) => item.key === id);
		if (pendingIndex >= 0) {
			const item = this.queue.splice(pendingIndex, 1)[0];
			if (!item) {
				return false;
			}

			item.abortController.abort();
			this.dedupe.markDequeued(item.key);
			item.reject?.(new ProcessingCanceledError());
			this.notifyQueueChange();
			return true;
		}

		if (this.activeItem?.key === id) {
			if (!this.activeItem.abortController.signal.aborted) {
				this.activeItem.abortController.abort();
			}
			this.activeItem.reject?.(new ProcessingCanceledError());
			this.notifyQueueChange();
			return true;
		}

		return false;
	}

	getQueueSnapshot(): ProcessingQueueSnapshot {
		const active = this.activeItem ? this.createQueueTaskSnapshot(this.activeItem, "running") : null;
		const pending = this.queue.map((item) => this.createQueueTaskSnapshot(item, "pending"));
		return {
			active,
			pending,
			totalCount: pending.length + (active ? 1 : 0),
		};
	}

	private async isStillAutoCandidate(item: QueueItem): Promise<boolean> {
		if (!item.binding) {
			return false;
		}

		const candidates = await this.getAutoCandidates(item.file);
		return candidates.some((candidate) => candidate.binding.id === item.binding?.id);
	}

	private findPendingAutoItem(slotKey: string): QueueItem | null {
		return this.queue.find((item) => item.source === "auto" && item.slotKey === slotKey) ?? null;
	}

	private updateAutoQueueItem(item: QueueItem, file: TFile, binding: TaskBinding): void {
		item.file = file;
		item.binding = binding;
		item.taskId = binding.taskId;
		item.slotKey = createQueueSlotKey(file.path, binding.taskId);
	}

	private createAutoQueueItem(file: TFile, binding: TaskBinding, slotKey: string): QueueItem {
		const key = createAutoQueueItemKey(slotKey);
		const item: QueueItem = {
			file,
			binding,
			source: "auto",
			key,
			slotKey,
			taskId: binding.taskId,
			queuedAt: Date.now(),
			abortController: new AbortController(),
		};
		this.dedupe.markQueued(key);
		return item;
	}

	private removeStalePendingAutoItems(filePath: string, candidateSlotKeys: Set<string>): void {
		for (const item of [...this.queue]) {
			if (item.source !== "auto" || item.slotKey !== createQueueSlotKey(filePath, item.taskId)) {
				continue;
			}

			if (!candidateSlotKeys.has(item.slotKey)) {
				this.removeQueuedItem(item);
			}
		}
	}

	private removeQueuedItem(item: QueueItem): void {
		const index = this.queue.indexOf(item);
		if (index < 0) {
			return;
		}

		this.queue.splice(index, 1);
		this.dedupe.markDequeued(item.key);
		item.abortController.abort();
	}

	private notifyQueueChange(): void {
		this.onQueueChange({
			pendingCount: this.queue.length,
			activeFilePath: this.activeItem?.file.path ?? null,
		});
	}

	private createQueueTaskSnapshot(item: QueueItem, status: QueueTaskStatus): QueueTaskSnapshot {
		const taskId = item.taskId;
		return {
			id: item.key,
			filePath: item.file.path,
			taskId,
			taskName: this.getTaskDefinition(taskId).name,
			source: item.source,
			status: item.abortController.signal.aborted ? "canceling" : status,
			queuedAt: item.queuedAt,
			startedAt: item.startedAt ?? null,
		};
	}

	destroy(): void {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.cancelAll();
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

function createAutoQueueItemKey(slotKey: string): string {
	return `auto:${slotKey}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}
