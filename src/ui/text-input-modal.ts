import { App, Modal, Setting } from "obsidian";

export interface TextInputModalOptions {
	title: string;
	description: string;
	placeholder: string;
	initialValue?: string;
	submitText: string;
	cancelText: string;
}

export function openTextInputModal(app: App, options: TextInputModalOptions): Promise<string | null> {
	return new Promise((resolve) => {
		new TextInputModal(app, options, resolve).open();
	});
}

class TextInputModal extends Modal {
	private options: TextInputModalOptions;
	private resolve: (value: string | null) => void;
	private resolved = false;

	constructor(app: App, options: TextInputModalOptions, resolve: (value: string | null) => void) {
		super(app);
		this.options = options;
		this.resolve = resolve;
	}

	onOpen(): void {
		this.setTitle(this.options.title);
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("p", {
			cls: "document-processing-modal-description",
			text: this.options.description,
		});

		const textarea = contentEl.createEl("textarea", {
			cls: "document-processing-anki-instruction-editor",
			attr: {
				placeholder: this.options.placeholder,
			},
		});
		textarea.value = this.options.initialValue ?? "";

		new Setting(contentEl)
			.addButton((button) => button
				.setButtonText(this.options.cancelText)
				.onClick(() => {
					this.finish(null);
				}))
			.addButton((button) => button
				.setButtonText(this.options.submitText)
				.setCta()
				.onClick(() => {
					this.finish(textarea.value);
				}));

		textarea.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) {
			this.finish(null);
		}
	}

	private finish(value: string | null): void {
		if (this.resolved) {
			return;
		}

		this.resolved = true;
		this.resolve(value);
		this.close();
	}
}
