import { ItemView, setIcon, WorkspaceLeaf } from "obsidian";
import type DocumentProcessingPlugin from "../main";
import { ProcessingQueueSnapshot, QueueTaskSnapshot } from "../tasks/auto-processor";
import type { QueueTaskStatus, TaskRunSource } from "../tasks/auto-processor";
import { ProcessingTaskId } from "../tasks/task-ids";
import { translate } from "../i18n";

export const PROCESSING_QUEUE_VIEW_TYPE = "document-processing-queue";

export class ProcessingQueueView extends ItemView {
	private plugin: DocumentProcessingPlugin;
	private refreshTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: DocumentProcessingPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return PROCESSING_QUEUE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return translate(this.plugin.settings.language, "queue.panel.title");
	}

	getIcon(): string {
		return "list-todo";
	}

	async onOpen(): Promise<void> {
		this.render();
		this.refreshTimer = window.setInterval(() => {
			this.render();
		}, 1000);
	}

	async onClose(): Promise<void> {
		if (this.refreshTimer !== null) {
			window.clearInterval(this.refreshTimer);
			this.refreshTimer = null;
		}
	}

	render(): void {
		const contentEl = this.containerEl.children[1] as HTMLElement;
		contentEl.empty();
		contentEl.addClass("document-processing-queue-view");

		const snapshot = this.plugin.getProcessingQueueSnapshot();
		this.renderHeader(contentEl, snapshot);

		if (!snapshot.active && snapshot.pending.length === 0) {
			contentEl.createDiv({
				cls: "document-processing-queue-empty",
				text: translate(this.plugin.settings.language, "queue.panel.empty"),
			});
			return;
		}

		if (snapshot.active) {
			this.renderSection(contentEl, translate(this.plugin.settings.language, "queue.panel.running"), [snapshot.active]);
		}

		if (snapshot.pending.length > 0) {
			this.renderSection(contentEl, translate(this.plugin.settings.language, "queue.panel.pending"), snapshot.pending);
		}
	}

	private renderHeader(containerEl: HTMLElement, snapshot: ProcessingQueueSnapshot): void {
		const headerEl = containerEl.createDiv({ cls: "document-processing-queue-header" });
		headerEl.createEl("h3", { text: translate(this.plugin.settings.language, "queue.panel.title") });
		headerEl.createDiv({
			cls: "document-processing-queue-count",
			text: translate(this.plugin.settings.language, "queue.panel.count", { count: snapshot.totalCount }),
		});

		const cancelAllButton = headerEl.createEl("button", {
			cls: "document-processing-queue-cancel-all",
			text: translate(this.plugin.settings.language, "queue.panel.cancelAll"),
		});
		cancelAllButton.disabled = snapshot.totalCount === 0;
		cancelAllButton.addEventListener("click", () => {
			this.plugin.cancelProcessingQueue();
		});
	}

	private renderSection(containerEl: HTMLElement, title: string, tasks: QueueTaskSnapshot[]): void {
		const sectionEl = containerEl.createDiv({ cls: "document-processing-queue-section" });
		sectionEl.createEl("h4", { text: title });

		for (const task of tasks) {
			this.renderTask(sectionEl, task);
		}
	}

	private renderTask(containerEl: HTMLElement, task: QueueTaskSnapshot): void {
		const taskEl = containerEl.createDiv({ cls: `document-processing-queue-task is-${task.status}` });

		const iconEl = taskEl.createDiv({ cls: "document-processing-queue-task-icon" });
		setIcon(iconEl, this.getTaskIcon(task.taskId));

		const bodyEl = taskEl.createDiv({ cls: "document-processing-queue-task-body" });
		const titleEl = bodyEl.createDiv({ cls: "document-processing-queue-task-title" });
		titleEl.createSpan({ text: this.plugin.getTaskDisplayName(task.taskId) });
		titleEl.createSpan({
			cls: "document-processing-queue-task-status",
			text: this.getStatusLabel(task.status),
		});

		bodyEl.createDiv({
			cls: "document-processing-queue-task-path",
			text: task.filePath,
		});
		bodyEl.createDiv({
			cls: "document-processing-queue-task-source",
			text: this.getSourceLabel(task.source),
		});
		bodyEl.createDiv({
			cls: "document-processing-queue-task-time",
			text: this.getTimeLabel(task),
		});

		const cancelButton = taskEl.createEl("button", { cls: "document-processing-queue-task-cancel" });
		setIcon(cancelButton, "x");
		cancelButton.setAttr("aria-label", translate(this.plugin.settings.language, "queue.panel.cancelTask"));
		cancelButton.title = translate(this.plugin.settings.language, "queue.panel.cancelTask");
		cancelButton.disabled = task.status === "canceling";
		cancelButton.addEventListener("click", () => {
			this.plugin.cancelProcessingQueueItem(task.id);
		});
	}

	private getTaskIcon(taskId: ProcessingTaskId): string {
		if (taskId === "anki-card-generation") {
			return "layers";
		}

		return "wand-sparkles";
	}

	private getStatusLabel(status: QueueTaskStatus): string {
		if (status === "running") {
			return translate(this.plugin.settings.language, "queue.status.running");
		}

		if (status === "canceling") {
			return translate(this.plugin.settings.language, "queue.status.canceling");
		}

		return translate(this.plugin.settings.language, "queue.status.pending");
	}

	private getSourceLabel(source: TaskRunSource): string {
		if (source === "auto") {
			return translate(this.plugin.settings.language, "queue.source.auto");
		}

		return translate(this.plugin.settings.language, "queue.source.manual");
	}

	private getTimeLabel(task: QueueTaskSnapshot): string {
		if (task.startedAt) {
			return translate(this.plugin.settings.language, "queue.time.running", {
				time: formatDuration(Date.now() - task.startedAt),
			});
		}

		return translate(this.plugin.settings.language, "queue.time.waiting", {
			time: formatDuration(Date.now() - task.queuedAt),
		});
	}
}

function formatDuration(durationMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor(totalSeconds % 3600 / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
	}

	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
