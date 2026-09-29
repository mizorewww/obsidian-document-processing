import { App, Modal, Setting } from "obsidian";

export interface ModelPickerModalOptions {
	title: string;
	description: string;
	searchPlaceholder: string;
	emptyText: string;
	saveText: string;
	cancelText: string;
	models: string[];
	initiallySelected: string[];
}

export function openModelPickerModal(app: App, options: ModelPickerModalOptions): Promise<string[] | null> {
	return new Promise((resolve) => {
		new ModelPickerModal(app, options, resolve).open();
	});
}

class ModelPickerModal extends Modal {
	private readonly selected: Set<string>;
	private listEl: HTMLElement | null = null;
	private query = "";
	private resolved = false;

	constructor(
		app: App,
		private readonly options: ModelPickerModalOptions,
		private readonly onResolve: (value: string[] | null) => void,
	) {
		super(app);
		this.selected = new Set(options.initiallySelected);
	}

	onOpen(): void {
		this.setTitle(this.options.title);
		const { contentEl } = this;
		contentEl.empty();
		this.modalEl.addClass("document-processing-model-picker");
		contentEl.createEl("p", {
			cls: "document-processing-modal-description",
			text: this.options.description,
		});

		new Setting(contentEl).addSearch((search) => search
			.setPlaceholder(this.options.searchPlaceholder)
			.onChange((value) => {
				this.query = value.trim().toLowerCase();
				this.renderList();
			}));

		this.listEl = contentEl.createDiv({ cls: "document-processing-model-picker-list" });
		this.renderList();

		new Setting(contentEl)
			.addButton((button) => button
				.setButtonText(this.options.cancelText)
				.onClick(() => {
					this.finish(null);
				}))
			.addButton((button) => button
				.setButtonText(this.options.saveText)
				.setCta()
				.onClick(() => {
					this.finish(this.options.models.filter((model) => this.selected.has(model)));
				}));
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) {
			this.finish(null);
		}
	}

	private renderList(): void {
		const listEl = this.listEl;
		if (!listEl) {
			return;
		}

		listEl.empty();
		const visible = this.options.models.filter((model) => !this.query || model.toLowerCase().includes(this.query));
		if (visible.length === 0) {
			listEl.createDiv({
				cls: "document-processing-model-picker-empty",
				text: this.options.emptyText,
			});
			return;
		}

		for (const model of visible) {
			new Setting(listEl)
				.setName(model)
				.addToggle((toggle) => toggle
					.setValue(this.selected.has(model))
					.onChange((checked) => {
						if (checked) {
							this.selected.add(model);
						} else {
							this.selected.delete(model);
						}
					}));
		}
	}

	private finish(value: string[] | null): void {
		if (this.resolved) {
			return;
		}

		this.resolved = true;
		this.onResolve(value);
		this.close();
	}
}
