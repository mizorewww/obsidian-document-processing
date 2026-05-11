import { Notice, Plugin, TFile } from "obsidian";
import { checkLlmConnection } from "./llm/check";
import { DocumentProcessingSettings, normalizeSettings } from "./settings-data";
import { DocumentProcessingSettingTab } from "./settings";
import { translate } from "./i18n";
import { getTaskDefinition } from "./tasks";
import { DEFAULT_PROCESSING_TASK_ID, ProcessingTaskId } from "./tasks/task-ids";
import { TaskRunner } from "./tasks/runner";
import { LlmProgressUpdate, LlmTokenUsage } from "./llm/token-usage";
import { AutoProcessor, AutoQueueState, ProcessingCanceledError, TaskRunSource } from "./tasks/auto-processor";
import { findTaskBindingForFile, TaskBinding } from "./tasks/bindings";
import { ProcessingResult } from "./tasks/types";
import { ANKI_CARD_GENERATION_TASK_ID } from "./tasks/anki-card-utils";

export default class DocumentProcessingPlugin extends Plugin {
	settings: DocumentProcessingSettings;
	private processingStatusEl: HTMLElement | null = null;
	private processingNotice: Notice | null = null;
	private autoProcessor: AutoProcessor | null = null;
	private activeQueuePending = 0;

	async onload() {
		await this.loadSettings();
		this.processingStatusEl = this.addStatusBarItem();
		this.processingStatusEl.hide();
		this.autoProcessor = new AutoProcessor({
			app: this.app,
			getSettings: () => this.settings,
			getTaskDefinition,
			runTask: (file, binding, source, pendingCount, taskId, signal) => this.runTaskFile(file, binding, source, pendingCount, taskId, signal),
			onQueueChange: (state) => this.handleAutoQueueChange(state),
			onAutoFailure: (file, error) => this.handleAutoFailure(file, error),
		});

		this.addCommand({
			id: "check-llm-connection",
			name: translate(this.settings.language, "command.checkSelectedModel"),
			callback: () => {
				void this.checkSelectedModel();
			},
		});

		this.addCommand({
			id: "process-current-clipping",
			name: translate(this.settings.language, "command.processCurrentClipping"),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!this.isMarkdownFile(file)) {
					return false;
				}

				if (!checking) {
					void this.processCurrentClipping(file);
				}

				return true;
			},
		});

		this.addCommand({
			id: "create-update-anki-cards",
			name: translate(this.settings.language, "command.createUpdateAnkiCards"),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!this.isMarkdownFile(file)) {
					return false;
				}

				if (!checking) {
					void this.processCurrentAnkiCards(file);
				}

				return true;
			},
		});

		this.addCommand({
			id: "cancel-processing-queue",
			name: translate(this.settings.language, "command.cancelProcessingQueue"),
			callback: () => this.cancelProcessingQueue(),
		});

		this.addRibbonActions();

		this.registerEvent(this.app.vault.on("create", (file) => {
			void this.autoProcessor?.handleCreate(file);
		}));
		this.registerEvent(this.app.vault.on("rename", (file) => {
			void this.autoProcessor?.handleRename(file);
		}));
		this.registerEvent(this.app.vault.on("modify", (file) => {
			this.autoProcessor?.handleModify(file);
		}));
		this.app.workspace.onLayoutReady(() => {
			void this.autoProcessor?.scanAll();
		});

		this.addSettingTab(new DocumentProcessingSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = normalizeSettings(await this.loadData() as Partial<DocumentProcessingSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private addRibbonActions(): void {
		this.addRibbonIcon("badge-check", translate(this.settings.language, "command.checkSelectedModel"), () => {
			void this.checkSelectedModel();
		});
		this.addRibbonIcon("wand-sparkles", translate(this.settings.language, "command.processCurrentClipping"), () => {
			const file = this.getActiveMarkdownFile();
			if (file) {
				void this.processCurrentClipping(file);
			}
		});
		this.addRibbonIcon("layers", translate(this.settings.language, "command.createUpdateAnkiCards"), () => {
			const file = this.getActiveMarkdownFile();
			if (file) {
				void this.processCurrentAnkiCards(file);
			}
		});
		this.addRibbonIcon("circle-stop", translate(this.settings.language, "command.cancelProcessingQueue"), () => {
			this.cancelProcessingQueue();
		});
	}

	private async checkSelectedModel(): Promise<void> {
		try {
			const result = await checkLlmConnection(this.settings, () => this.saveSettings());
			new Notice(result.message);
		} catch (error) {
			const message = error instanceof Error ? error.message : translate(this.settings.language, "check.failed");
			new Notice(message);
		}
	}

	private getActiveMarkdownFile(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		if (!this.isMarkdownFile(file)) {
			new Notice(translate(this.settings.language, "task.process.noActiveMarkdown"));
			return null;
		}

		return file;
	}

	private async processCurrentClipping(file: TFile): Promise<void> {
		if (!this.autoProcessor) {
			return;
		}

		const binding = findTaskBindingForFile(
			file.path,
			this.settings.taskBindings.filter((item) => item.taskId === DEFAULT_PROCESSING_TASK_ID),
		);
		new Notice(translate(this.settings.language, "task.process.queued"));

		try {
			const result = await this.autoProcessor.enqueueManual(file, binding);
			this.hideProcessingProgress();
			if (this.settings.showCompletionNotice) {
				new Notice(this.getSuccessMessage(result.tokenUsage));
			}
		} catch (error) {
			this.hideProcessingProgress();
			if (isProcessingCanceled(error)) {
				new Notice(translate(this.settings.language, "task.queue.canceled"));
				return;
			}

			const message = error instanceof Error ? error.message : String(error);
			new Notice(translate(this.settings.language, "task.process.failure", { message }));
		}
	}

	private async processCurrentAnkiCards(file: TFile): Promise<void> {
		if (!this.autoProcessor) {
			return;
		}

		const binding = findTaskBindingForFile(
			file.path,
			this.settings.taskBindings.filter((item) => item.taskId === ANKI_CARD_GENERATION_TASK_ID),
		);
		new Notice(translate(this.settings.language, "task.process.queued"));

		try {
			const result = await this.autoProcessor.enqueueManual(file, binding, ANKI_CARD_GENERATION_TASK_ID);
			this.hideProcessingProgress();
			if (this.settings.showCompletionNotice) {
				new Notice(this.getSuccessMessage(result.tokenUsage));
			}
		} catch (error) {
			this.hideProcessingProgress();
			if (isProcessingCanceled(error)) {
				new Notice(translate(this.settings.language, "task.queue.canceled"));
				return;
			}

			const message = error instanceof Error ? error.message : String(error);
			new Notice(translate(this.settings.language, "task.process.failure", { message }));
		}
	}

	private async runTaskFile(
		file: TFile,
		binding: TaskBinding | null,
		source: TaskRunSource,
		pendingCount: number,
		taskId?: ProcessingTaskId,
		signal?: AbortSignal,
	): Promise<ProcessingResult> {
		let latestUsage: LlmTokenUsage | undefined;
		this.activeQueuePending = pendingCount;
		this.showProcessingProgress(this.getTaskStartMessage(file, source), source === "manual");

		try {
			const task = getTaskDefinition(taskId ?? binding?.taskId ?? DEFAULT_PROCESSING_TASK_ID);
			const runner = new TaskRunner({
				app: this.app,
				manifest: this.manifest,
				settings: this.settings,
				saveSettings: () => this.saveSettings(),
				onLlmProgress: (progress) => {
					latestUsage = progress;
					this.updateProcessingProgress(progress);
				},
			});
			const result = await runner.run(task, file, { binding, signal });
			return {
				...result,
				tokenUsage: result.tokenUsage ?? latestUsage,
			};
		} finally {
			this.hideProcessingProgress();
		}
	}

	private isMarkdownFile(file: TFile | null): file is TFile {
		return file instanceof TFile && file.extension === "md";
	}

	private showProcessingProgress(message: string, showNotice: boolean): void {
		this.processingNotice?.hide();
		this.processingNotice = showNotice ? new Notice(message, 0) : null;
		this.setProcessingStatus(message);
	}

	private updateProcessingProgress(progress: LlmProgressUpdate): void {
		const key = progress.phase === "completed" ? "task.process.progressDone" : "task.process.progress";
		const message = this.addQueueToMessage(translate(this.settings.language, key, this.formatUsage(progress)));
		this.processingNotice?.setMessage(message);
		this.setProcessingStatus(message);
	}

	private hideProcessingProgress(): void {
		this.processingNotice?.hide();
		this.processingNotice = null;
		if (this.processingStatusEl && this.activeQueuePending === 0) {
			this.processingStatusEl.hide();
			this.processingStatusEl.setText("");
		}
	}

	private setProcessingStatus(message: string): void {
		if (!this.processingStatusEl) {
			return;
		}

		this.processingStatusEl.show();
		this.processingStatusEl.setText(message);
	}

	private getSuccessMessage(usage: LlmTokenUsage | undefined): string {
		if (!usage) {
			return translate(this.settings.language, "task.process.success");
		}

		return translate(this.settings.language, "task.process.successWithTokens", this.formatUsage(usage));
	}

	private getTaskStartMessage(file: TFile, source: TaskRunSource): string {
		const key = source === "auto" ? "task.auto.start" : "task.process.start";
		const message = translate(this.settings.language, key, { path: file.path });
		return this.addQueueToMessage(message);
	}

	private handleAutoQueueChange(state: AutoQueueState): void {
		this.activeQueuePending = state.pendingCount;
		if (!state.activeFilePath && state.pendingCount > 0) {
			this.setProcessingStatus(translate(this.settings.language, "task.queue.waiting", { count: state.pendingCount }));
		}

		if (!state.activeFilePath && state.pendingCount === 0 && !this.processingNotice) {
			this.hideProcessingProgress();
		}
	}

	private handleAutoFailure(file: TFile, error: unknown): void {
		if (isProcessingCanceled(error)) {
			return;
		}

		const message = error instanceof Error ? error.message : String(error);
		new Notice(translate(this.settings.language, "task.auto.failure", {
			path: file.path,
			message,
		}));
	}

	private cancelProcessingQueue(): void {
		const canceledCount = this.autoProcessor?.cancelAll() ?? 0;
		this.hideProcessingProgress();
		new Notice(canceledCount > 0
			? translate(this.settings.language, "task.queue.canceledWithCount", { count: canceledCount })
			: translate(this.settings.language, "task.queue.empty"));
	}

	private addQueueToMessage(message: string): string {
		if (this.activeQueuePending < 1) {
			return message;
		}

		return translate(this.settings.language, "task.queue.withProgress", {
			message,
			count: this.activeQueuePending,
		});
	}

	private formatUsage(usage: LlmTokenUsage): Record<string, string> {
		return {
			input: this.formatTokenCount(usage.inputTokens, usage.inputTokensEstimated),
			output: this.formatTokenCount(usage.outputTokens, usage.outputTokensEstimated),
		};
	}

	private formatTokenCount(tokens: number, estimated: boolean): string {
		const prefix = estimated ? "~" : "";
		if (tokens >= 1000000) {
			return `${prefix}${(tokens / 1000000).toFixed(1)}M`;
		}

		if (tokens >= 1000) {
			return `${prefix}${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k`;
		}

		return `${prefix}${tokens}`;
	}
}

function isProcessingCanceled(error: unknown): boolean {
	return error instanceof ProcessingCanceledError
		|| error instanceof DOMException && error.name === "AbortError"
		|| error instanceof Error && /canceled|cancelled|aborted/iu.test(error.message);
}
