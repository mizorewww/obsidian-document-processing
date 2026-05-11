import { Notice, Plugin } from "obsidian";
import { checkLlmConnection } from "./llm/check";
import { DocumentProcessingSettings, normalizeSettings } from "./settings-data";
import { DocumentProcessingSettingTab } from "./settings";
import { translate } from "./i18n";

export default class DocumentProcessingPlugin extends Plugin {
	settings: DocumentProcessingSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "check-llm-connection",
			name: translate(this.settings.language, "command.checkSelectedModel"),
			callback: async () => {
				try {
					const result = await checkLlmConnection(this.settings, () => this.saveSettings());
					new Notice(result.message);
				} catch (error) {
					const message = error instanceof Error ? error.message : translate(this.settings.language, "check.failed");
					new Notice(message);
				}
			},
		});

		this.addSettingTab(new DocumentProcessingSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = normalizeSettings(await this.loadData() as Partial<DocumentProcessingSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
