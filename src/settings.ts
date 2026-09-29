import { App, ExtraButtonComponent, Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import type DocumentProcessingPlugin from "./main";
import { translate, LanguageSetting, resolveLanguage } from "./i18n";
import { checkLlmConnection } from "./llm/check";
import { fetchOpenAiModels } from "./llm/openai-models";
import { normalizeOpenAiBaseUrl } from "./llm/openai-client";
import {
	CODEX_DEVICE_VERIFICATION_URL,
	completeCodexDeviceLogin,
	isCodexCloudflareChallengeError,
	isCodexLoginAbortError,
	requestCodexDeviceCode,
} from "./llm/codex-auth";
import {
	CODEX_MODELS,
	CODEX_REASONING_EFFORTS,
	CODEX_SERVICE_TIERS,
	CodexReasoningEffort,
	CodexServiceTier,
	getModelOption,
	ModelOption,
	OLLAMA_CLOUD_MODELS,
	OPENAI_API_MODELS,
} from "./llm/models";
import { OLLAMA_CLOUD_BASE_URL } from "./llm/ollama-cloud";
import { AnkiCardLanguage, CodexAuthData, LlmConnectionCheckRecord, LlmProvider } from "./settings-data";
import { TASK_DEFINITIONS } from "./tasks";
import { getTaskDisplayName } from "./tasks/labels";
import {
	createTaskBindingId,
	DEFAULT_TASK_BINDING_FOLDER,
	getTaskPrompt,
	normalizeVaultFolderPath,
	TaskBinding,
} from "./tasks/bindings";
import { ANKI_CARD_GENERATION_TASK_ID, ProcessingTaskId } from "./tasks/task-ids";
import { openModelPickerModal } from "./ui/model-picker-modal";
import { TaskDefinition } from "./tasks/types";

const LANGUAGE_SETTINGS: LanguageSetting[] = ["auto", "zh-CN", "en"];
const PROVIDERS: LlmProvider[] = ["openai-api", "codex-login", "ollama-cloud"];
const ANKI_CARD_LANGUAGES: AnkiCardLanguage[] = ["zh-CN", "en", "match-note"];

export class DocumentProcessingSettingTab extends PluginSettingTab {
	plugin: DocumentProcessingPlugin;
	private loginAbortController: AbortController | null = null;

	constructor(app: App, plugin: DocumentProcessingPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		this.addGeneralSection(containerEl);
		this.addAccountSection(containerEl);
		this.addModelSection(containerEl);
		this.addProcessingSection(containerEl);
		this.addCheckSection(containerEl);
	}

	private addGeneralSection(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(this.t("setting.language.name"))
			.setDesc(this.t("setting.language.desc"))
			.addDropdown((dropdown) => {
				for (const language of LANGUAGE_SETTINGS) {
					dropdown.addOption(language, this.getLanguageLabel(language));
				}

				dropdown
					.setValue(this.plugin.settings.language)
					.onChange(async (value) => {
						this.plugin.settings.language = value as LanguageSetting;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		new Setting(containerEl)
			.setName(this.t("setting.provider.name"))
			.setDesc(this.t("setting.provider.desc"))
			.addDropdown((dropdown) => {
				for (const provider of PROVIDERS) {
					dropdown.addOption(provider, this.getProviderLabel(provider));
				}

				dropdown
					.setValue(this.plugin.settings.llmProvider)
					.onChange(async (value) => {
						this.cancelActiveCodexLogin();
						this.plugin.settings.llmProvider = value as LlmProvider;
						await this.plugin.saveSettings();
						this.display();
					});
			});
	}

	private addAccountSection(containerEl: HTMLElement): void {
		if (this.plugin.settings.llmProvider === "openai-api") {
			this.addOpenAiAccountSection(containerEl);
			return;
		}

		if (this.plugin.settings.llmProvider === "ollama-cloud") {
			this.addOllamaCloudAccountSection(containerEl);
			return;
		}

		this.addCodexAccountSection(containerEl);
	}

	private addOpenAiAccountSection(containerEl: HTMLElement): void {
		const sectionEl = this.addSection(containerEl, this.t("section.account"));
		const apiKey = this.plugin.settings.openaiApiKey.trim();

		new Setting(sectionEl)
			.setName(this.t("account.status"))
			.setDesc(apiKey ? this.t("api.keySaved", { key: this.maskApiKey(apiKey) }) : this.t("api.keyMissing"));

		new Setting(sectionEl)
			.setName(this.t("api.key.name"))
			.setDesc(this.t("api.key.desc"))
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder(this.t("api.key.placeholder"))
					.setValue(this.plugin.settings.openaiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openaiApiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		let endpointDraft = this.plugin.settings.openaiBaseUrl;
		new Setting(sectionEl)
			.setName(this.t("api.endpoint.name"))
			.setDesc(this.t("api.endpoint.desc"))
			.addText((text) => {
				text
					.setPlaceholder(this.t("api.endpoint.placeholder"))
					.setValue(this.plugin.settings.openaiBaseUrl)
					.onChange((value) => {
						endpointDraft = value;
					});
				text.inputEl.addEventListener("change", () => {
					void this.commitOpenAiEndpoint(endpointDraft);
				});
			})
			.addExtraButton((button) => button
				.setIcon("refresh-cw")
				.setTooltip(this.t("model.refresh.tooltip"))
				.onClick(() => {
					void this.openOpenAiModelPicker(button);
				}));
	}

	private async commitOpenAiEndpoint(rawValue: string): Promise<void> {
		let normalized: string;
		try {
			normalized = normalizeOpenAiBaseUrl(rawValue);
		} catch {
			new Notice(this.t("api.endpoint.invalid"));
			this.display();
			return;
		}

		if (normalized === this.plugin.settings.openaiBaseUrl) {
			return;
		}

		this.plugin.settings.openaiBaseUrl = normalized;
		this.plugin.settings.openaiAvailableModels = [];
		await this.plugin.saveSettings();
		this.display();
	}

	private addOllamaCloudAccountSection(containerEl: HTMLElement): void {
		const sectionEl = this.addSection(containerEl, this.t("section.account"));
		const apiKey = this.plugin.settings.ollamaApiKey.trim();

		new Setting(sectionEl)
			.setName(this.t("account.status"))
			.setDesc(apiKey ? this.t("api.keySaved", { key: this.maskApiKey(apiKey) }) : this.t("api.keyMissing"));

		new Setting(sectionEl)
			.setName(this.t("ollama.key.name"))
			.setDesc(this.t("ollama.key.desc"))
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder(this.t("api.key.placeholder"))
					.setValue(this.plugin.settings.ollamaApiKey)
					.onChange(async (value) => {
						this.plugin.settings.ollamaApiKey = value.trim();
						await this.plugin.saveSettings();
					});
			})
			.addExtraButton((button) => button
				.setIcon("refresh-cw")
				.setTooltip(this.t("model.refresh.tooltip"))
				.onClick(() => {
					void this.openOllamaModelPicker(button);
				}));

		new Setting(sectionEl)
			.setName(this.t("ollama.endpoint.name"))
			.setDesc(this.t("ollama.endpoint.desc"));
	}

	private addCodexAccountSection(containerEl: HTMLElement): void {
		const sectionEl = this.addSection(containerEl, this.t("section.account"));
		const auth = this.plugin.settings.codexAuth;

		new Setting(sectionEl)
			.setName(this.t("account.status"))
			.setDesc(this.formatCodexAccount(auth));

		const liveStatusEl = sectionEl.createDiv({ cls: "document-processing-login-status" });

		new Setting(sectionEl)
			.setName(this.t("codex.signIn.name"))
			.setDesc(this.t("codex.signIn.desc"))
			.addButton((button) => button
				.setButtonText(auth ? this.t("codex.signInAgain.button") : this.t("codex.signIn.button"))
				.setIcon(auth ? "refresh-cw" : "log-in")
				.setCta()
				.onClick(async () => {
					this.cancelActiveCodexLogin();
					const loginController = new AbortController();
					this.loginAbortController = loginController;
					button.setDisabled(true);
					button.setButtonText(this.t("codex.requestingCode"));
					liveStatusEl.setText(this.t("codex.requestingCode"));

					try {
						const deviceCode = await requestCodexDeviceCode();
						if (!this.isActiveLogin(loginController)) {
							return;
						}

						const copied = await this.copyToClipboard(deviceCode.userCode);
						if (!this.isActiveLogin(loginController)) {
							return;
						}

						this.renderDeviceCodeStatus(liveStatusEl, deviceCode.verificationUrl, deviceCode.userCode, copied);
						new Notice(copied ? this.t("codex.codeCopied.notice") : this.t("codex.codeCopyFailed.notice"));
						window.open(deviceCode.verificationUrl, "_blank", "noopener");
						button.setButtonText(this.t("codex.restart.button"));
						button.setIcon("rotate-ccw");
						button.setDisabled(false);

						const nextAuth = await completeCodexDeviceLogin(deviceCode, loginController.signal);
						if (!this.isActiveLogin(loginController)) {
							return;
						}

						this.plugin.settings.codexAuth = nextAuth;
						await this.plugin.saveSettings();
						this.loginAbortController = null;
						new Notice(this.t("codex.signInDone.notice"));
						this.display();
					} catch (error) {
						if (!this.isActiveLogin(loginController)) {
							return;
						}

						const message = this.formatLoginError(error);
						this.loginAbortController = null;
						liveStatusEl.setText(message);
						button.setButtonText(this.plugin.settings.codexAuth
							? this.t("codex.signInAgain.button")
							: this.t("codex.signIn.button"));
						button.setIcon(this.plugin.settings.codexAuth ? "refresh-cw" : "log-in");
						button.setDisabled(false);
						new Notice(message);
					}
				}))
			.addButton((button) => button
				.setButtonText(this.t("codex.signOut.button"))
				.setIcon("log-out")
				.setDisabled(!auth)
				.onClick(async () => {
					this.cancelActiveCodexLogin();
					this.plugin.settings.codexAuth = null;
					await this.plugin.saveSettings();
					new Notice(this.t("codex.signedOut.notice"));
					this.display();
				}));

		sectionEl.appendChild(liveStatusEl);
	}

	private addModelSection(containerEl: HTMLElement): void {
		const sectionEl = this.addSection(containerEl, this.t("section.model"));
		const provider = this.plugin.settings.llmProvider;
		const options = provider === "codex-login" ? CODEX_MODELS : this.getApiKeyModelOptions(provider);

		this.addModelSetting({
			containerEl: sectionEl,
			model: this.getCurrentModel(),
			options,
			onChange: async (model) => {
				if (provider === "codex-login") {
					this.plugin.settings.codexModel = model;
				} else if (provider === "ollama-cloud") {
					this.plugin.settings.ollamaModel = model;
				} else {
					this.plugin.settings.openaiModel = model;
				}
				await this.plugin.saveSettings();
			},
		});

		if (provider === "codex-login") {
			this.addCodexPerformanceSettings(sectionEl);
		}
	}

	private addModelSetting(config: {
		containerEl: HTMLElement;
		model: string;
		options: ModelOption[];
		onChange: (model: string) => Promise<void>;
	}): void {
		const currentOption = getModelOption(config.options, config.model);

		new Setting(config.containerEl)
			.setName(this.t("model.name"))
			.setDesc(this.getModelSettingDescription())
			.addDropdown((dropdown) => {
				for (const option of config.options) {
					dropdown.addOption(option.id, option.name);
				}

				if (!currentOption && config.model.trim()) {
					dropdown.addOption(config.model, this.t("model.customOption", { model: config.model }));
				}

				dropdown
					.setValue(config.model)
					.onChange(async (value) => {
						await config.onChange(value);
						this.display();
					});
			});

		new Setting(config.containerEl)
			.setName(this.t("model.custom.name"))
			.setDesc(this.t("model.custom.desc"))
			.addText((text) => {
				let draft = "";
				text
					.setPlaceholder(this.t("model.custom.placeholder"))
					.onChange((value) => {
						draft = value;
					});
				text.inputEl.addEventListener("change", () => {
					const model = draft.trim();
					if (!model) {
						return;
					}

					void config.onChange(model).then(() => this.display());
				});
			});
	}

	private addCodexPerformanceSettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(this.t("codex.intelligence.name"))
			.setDesc(this.t("codex.intelligence.desc"))
			.addDropdown((dropdown) => {
				for (const option of CODEX_REASONING_EFFORTS) {
					const effort = option.id as CodexReasoningEffort;
					dropdown.addOption(option.id, `${this.getReasoningEffortLabel(effort)} - ${this.getReasoningEffortDescription(effort)}`);
				}

				dropdown
					.setValue(this.plugin.settings.codexReasoningEffort)
					.onChange(async (value) => {
						this.plugin.settings.codexReasoningEffort = value as CodexReasoningEffort;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		new Setting(containerEl)
			.setName(this.t("codex.speed.name"))
			.setDesc(this.t("codex.speed.desc"))
			.addDropdown((dropdown) => {
				for (const option of CODEX_SERVICE_TIERS) {
					const tier = option.id as CodexServiceTier;
					dropdown.addOption(option.id, `${this.getServiceTierLabel(tier)} - ${this.getServiceTierDescription(tier)}`);
				}

				dropdown
					.setValue(this.plugin.settings.codexServiceTier)
					.onChange(async (value) => {
						this.plugin.settings.codexServiceTier = value as CodexServiceTier;
						await this.plugin.saveSettings();
						this.display();
					});
			});
	}

	private addProcessingSection(containerEl: HTMLElement): void {
		const sectionEl = this.addSection(containerEl, this.t("section.processing"));

		for (const task of TASK_DEFINITIONS) {
			this.addTaskSection(sectionEl, task);
		}

		new Setting(sectionEl)
			.setName(this.t("processing.cacheRetention.name"))
			.setDesc(this.t("processing.cacheRetention.desc"))
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.inputEl.step = "1";
				text
					.setPlaceholder(this.t("processing.cacheRetention.placeholder"))
					.setValue(String(this.plugin.settings.cacheRetentionLimit))
					.onChange(async (value) => {
						const parsed = Number(value);
						if (!Number.isFinite(parsed) || parsed < 1) {
							return;
						}

						this.plugin.settings.cacheRetentionLimit = Math.round(parsed);
						await this.plugin.saveSettings();
					});
			});

		new Setting(sectionEl)
			.setName(this.t("processing.showCompletionNotice.name"))
			.setDesc(this.t("processing.showCompletionNotice.desc"))
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.showCompletionNotice)
				.onChange(async (value) => {
					this.plugin.settings.showCompletionNotice = value;
					await this.plugin.saveSettings();
				}));
	}

	private addTaskSection(containerEl: HTMLElement, task: TaskDefinition): void {
		const taskEl = containerEl.createDiv({ cls: "document-processing-task" });
		const bindings = this.plugin.settings.taskBindings.filter((binding) => binding.taskId === task.id);

		new Setting(taskEl)
			.setName(this.getTaskLabel(task.id))
			.setDesc(this.t("processing.task.desc", { count: bindings.length }))
			.setHeading()
			.addButton((button) => button
				.setButtonText(this.t("processing.binding.add"))
				.setIcon("plus")
				.onClick(async () => {
					this.plugin.settings.taskBindings.push({
						id: createTaskBindingId(this.plugin.settings.taskBindings.length),
						autoProcess: false,
						folderPath: DEFAULT_TASK_BINDING_FOLDER,
						taskId: task.id,
						recursive: true,
						promptOverride: "",
					});
					await this.plugin.saveSettings();
					this.display();
				}));

		if (task.id === ANKI_CARD_GENERATION_TASK_ID) {
			this.addAnkiCardLanguageSetting(taskEl);
		}

		for (const binding of bindings) {
			this.addTaskBinding(taskEl, task, binding);
		}
	}

	private addAnkiCardLanguageSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(this.t("processing.anki.language.name"))
			.setDesc(this.t("processing.anki.language.desc"))
			.addDropdown((dropdown) => {
				for (const language of ANKI_CARD_LANGUAGES) {
					dropdown.addOption(language, this.getAnkiCardLanguageLabel(language));
				}

				dropdown
					.setValue(this.plugin.settings.ankiCardLanguage)
					.onChange(async (value) => {
						this.plugin.settings.ankiCardLanguage = value as AnkiCardLanguage;
						await this.plugin.saveSettings();
					});
			});
	}

	private addTaskBinding(containerEl: HTMLElement, task: TaskDefinition, binding: TaskBinding): void {
		const folderPath = normalizeVaultFolderPath(binding.folderPath);
		const missingFolder = folderPath && !this.app.vault.getFolderByPath(folderPath);
		const bindingEl = containerEl.createDiv({ cls: "document-processing-binding" });

		new Setting(bindingEl)
			.setName(folderPath || this.t("processing.bindings.name"))
			.setDesc(missingFolder
				? this.t("processing.binding.folder.missing", { path: folderPath })
				: this.getTaskLabel(binding.taskId))
			.addButton((button) => button
				.setButtonText("")
				.setIcon("trash")
				.onClick(async () => {
					this.plugin.settings.taskBindings = this.plugin.settings.taskBindings.filter((item) => item.id !== binding.id);
					await this.plugin.saveSettings();
					this.display();
				}));

		new Setting(bindingEl)
			.setName(this.t("processing.binding.auto.name"))
			.setDesc(this.t("processing.binding.auto.desc"))
			.addToggle((toggle) => toggle
				.setValue(binding.autoProcess)
				.onChange(async (value) => {
					binding.autoProcess = value;
					await this.plugin.saveSettings();
				}));

		new Setting(bindingEl)
			.setName(this.t("processing.binding.folder.name"))
			.setDesc(this.t("processing.binding.folder.desc"))
			.addText((text) => text
				.setPlaceholder(this.t("processing.binding.folder.placeholder"))
				.setValue(binding.folderPath)
				.onChange(async (value) => {
					binding.folderPath = normalizeVaultFolderPath(value);
					await this.plugin.saveSettings();
				}));

		new Setting(bindingEl)
			.setName(this.t("processing.binding.recursive.name"))
			.setDesc(this.t("processing.binding.recursive.desc"))
			.addToggle((toggle) => toggle
				.setValue(binding.recursive)
				.onChange(async (value) => {
					binding.recursive = value;
					await this.plugin.saveSettings();
				}));

		new Setting(bindingEl)
			.setName(this.t("processing.binding.prompt.name"))
			.setDesc(binding.promptOverride.trim()
				? this.t("processing.binding.prompt.custom")
				: this.t("processing.binding.prompt.default"))
			.addButton((button) => button
				.setButtonText(this.t("processing.binding.prompt.edit"))
				.setIcon("pencil")
				.onClick(() => {
					new PromptEditModal(this.app, {
						title: this.t("processing.binding.prompt.modalTitle"),
						value: getTaskPrompt(task, binding),
						onSave: async (value) => {
							binding.promptOverride = value.trim() === task.defaultPrompt.trim() ? "" : value;
							await this.plugin.saveSettings();
							this.display();
						},
						saveText: this.t("processing.binding.prompt.save"),
						cancelText: this.t("processing.binding.prompt.cancel"),
					}).open();
				}))
			.addButton((button) => button
				.setButtonText(this.t("processing.binding.prompt.reset"))
				.setIcon("rotate-ccw")
				.onClick(async () => {
					binding.promptOverride = "";
					await this.plugin.saveSettings();
					this.display();
				}));
	}

	private addCheckSection(containerEl: HTMLElement): void {
		const sectionEl = this.addSection(containerEl, this.t("section.check"));
		const statusSetting = new Setting(sectionEl)
			.setName(this.t("check.status.name"))
			.setDesc(this.getLastCheckSummary());

		new Setting(sectionEl)
			.setName(this.t("check.button.name"))
			.setDesc(this.t("check.button.desc"))
			.addButton((button) => button
				.setButtonText(this.t("check.button"))
				.setIcon("activity")
				.setCta()
				.onClick(async () => {
					button.setDisabled(true);
					statusSetting.setDesc(this.t("check.running"));

					try {
						const result = await checkLlmConnection(this.plugin.settings, () => this.plugin.saveSettings());
						await this.recordConnectionCheck({
							provider: this.plugin.settings.llmProvider,
							model: result.model,
							ok: true,
							message: result.message,
							latencyMs: result.latencyMs,
							checkedAt: new Date().toISOString(),
						});
						statusSetting.setDesc(result.message);
						new Notice(result.message);
						this.display();
					} catch (error) {
						const message = error instanceof Error ? error.message : this.t("check.failed");
						await this.recordConnectionCheck({
							provider: this.plugin.settings.llmProvider,
							model: this.getCurrentModel(),
							ok: false,
							message,
							checkedAt: new Date().toISOString(),
						});
						statusSetting.setDesc(message);
						new Notice(message);
						this.display();
					} finally {
						button.setDisabled(false);
					}
				}));
	}

	private addSection(containerEl: HTMLElement, title: string): HTMLElement {
		const sectionEl = containerEl.createDiv({ cls: "document-processing-settings-section" });
		new Setting(sectionEl)
			.setName(title)
			.setHeading();
		return sectionEl;
	}

	private renderDeviceCodeStatus(containerEl: HTMLElement, verificationUrl: string, userCode: string, copied: boolean): void {
		containerEl.empty();
		const lineEl = containerEl.createDiv();
		lineEl.createSpan({ text: `${this.t("codex.device.open")} ` });
		const linkEl = lineEl.createEl("a", {
			text: this.t("codex.device.page"),
			href: verificationUrl,
		});
		linkEl.setAttr("target", "_blank");
		linkEl.setAttr("rel", "noopener");
		lineEl.createSpan({ text: ` ${this.t("codex.device.enterCode")}` });
		containerEl.createEl("code", {
			text: userCode,
			cls: "document-processing-login-code",
		});
		containerEl.createDiv({
			text: copied ? this.t("codex.device.copied") : this.t("codex.device.copyFailed"),
		});
		containerEl.createDiv({
			text: this.t("codex.device.restartHint"),
			cls: "document-processing-settings-note",
		});
	}

	private async recordConnectionCheck(record: LlmConnectionCheckRecord): Promise<void> {
		this.plugin.settings.lastConnectionCheck = record;
		await this.plugin.saveSettings();
	}

	private getCurrentProviderCheck(): LlmConnectionCheckRecord | null {
		const check = this.plugin.settings.lastConnectionCheck;
		if (!check || check.provider !== this.plugin.settings.llmProvider) {
			return null;
		}

		return check;
	}

	private getCurrentModel(): string {
		if (this.plugin.settings.llmProvider === "codex-login") {
			return this.plugin.settings.codexModel;
		}

		if (this.plugin.settings.llmProvider === "ollama-cloud") {
			return this.plugin.settings.ollamaModel;
		}

		return this.plugin.settings.openaiModel;
	}

	private getApiKeyModelOptions(provider: "openai-api" | "ollama-cloud"): ModelOption[] {
		const remoteModels = provider === "openai-api"
			? this.plugin.settings.openaiAvailableModels
			: this.plugin.settings.ollamaAvailableModels;
		if (!remoteModels.length) {
			return provider === "openai-api" ? OPENAI_API_MODELS : OLLAMA_CLOUD_MODELS;
		}

		return remoteModels.map((id) => ({
			id,
			name: id,
			description: this.t("model.remoteDescription"),
		}));
	}

	private getModelSettingDescription(): string {
		if (this.plugin.settings.llmProvider === "codex-login") {
			return this.t("model.desc");
		}

		const count = this.plugin.settings.llmProvider === "ollama-cloud"
			? this.plugin.settings.ollamaAvailableModels.length
			: this.plugin.settings.openaiAvailableModels.length;
		return count ? this.t("model.remote.desc", { count }) : this.t("model.desc");
	}

	private async openOpenAiModelPicker(button: ExtraButtonComponent): Promise<void> {
		await this.openApiKeyModelPicker(button, "openai-api");
	}

	private async openOllamaModelPicker(button: ExtraButtonComponent): Promise<void> {
		await this.openApiKeyModelPicker(button, "ollama-cloud");
	}

	private async openApiKeyModelPicker(button: ExtraButtonComponent, provider: "openai-api" | "ollama-cloud"): Promise<void> {
		const apiKey = this.getApiKeyProviderApiKey(provider);
		if (this.plugin.settings.llmProvider !== provider || !apiKey) {
			new Notice(this.t(provider === "openai-api" ? "check.error.missingApiKey" : "check.error.missingOllamaKey"));
			return;
		}

		button.setDisabled(true);
		try {
			const baseUrl = this.getApiKeyProviderBaseUrl(provider);
			const models = await fetchOpenAiModels(apiKey, baseUrl);
			if (provider === "openai-api") {
				this.plugin.settings.openaiBaseUrl = baseUrl;
			}
			if (models.length === 0) {
				await this.plugin.saveSettings();
				new Notice(this.t("model.refresh.done", { count: 0 }));
				this.display();
				return;
			}

			const chosen = await openModelPickerModal(this.app, {
				title: this.t("model.picker.title"),
				description: this.t("model.picker.desc", { endpoint: baseUrl, count: models.length }),
				searchPlaceholder: this.t("model.picker.searchPlaceholder"),
				emptyText: this.t("model.picker.empty"),
				saveText: this.t("model.picker.save"),
				cancelText: this.t("model.picker.cancel"),
				models,
				initiallySelected: this.getInitialModelPickerSelection(provider, models),
			});
			if (chosen === null) {
				return;
			}

			if (provider === "openai-api") {
				this.plugin.settings.openaiAvailableModels = chosen;
			} else {
				this.plugin.settings.ollamaAvailableModels = chosen;
			}
			await this.plugin.saveSettings();
			new Notice(this.t("model.refresh.done", { count: chosen.length }));
			this.display();
		} catch (error) {
			console.error("Document Processing model refresh failed", error);
			const message = error instanceof Error ? error.message : this.t("model.refresh.failed");
			new Notice(message);
		} finally {
			button.setDisabled(false);
		}
	}

	private getApiKeyProviderApiKey(provider: "openai-api" | "ollama-cloud"): string {
		return provider === "openai-api"
			? this.plugin.settings.openaiApiKey.trim()
			: this.plugin.settings.ollamaApiKey.trim();
	}

	private getApiKeyProviderBaseUrl(provider: "openai-api" | "ollama-cloud"): string {
		return provider === "openai-api"
			? normalizeOpenAiBaseUrl(this.plugin.settings.openaiBaseUrl)
			: OLLAMA_CLOUD_BASE_URL;
	}

	private getInitialModelPickerSelection(provider: "openai-api" | "ollama-cloud", models: string[]): string[] {
		const available = new Set(models);
		const saved = provider === "openai-api"
			? this.plugin.settings.openaiAvailableModels
			: this.plugin.settings.ollamaAvailableModels;
		const currentModel = provider === "openai-api"
			? this.plugin.settings.openaiModel
			: this.plugin.settings.ollamaModel;
		const selected = saved.filter((model) => available.has(model));
		if (selected.length === 0 && available.has(currentModel)) {
			selected.push(currentModel);
		}

		return selected;
	}

	private getLastCheckSummary(): string {
		const check = this.getCurrentProviderCheck();
		if (!check) {
			return this.t("check.status.empty");
		}

		return this.formatCheckDetail(check);
	}

	private formatCheckDetail(check: LlmConnectionCheckRecord): string {
		const status = check.ok ? this.t("check.ok") : this.t("check.bad");
		const latency = check.latencyMs ? this.t("check.latency", { latency: check.latencyMs }) : "";
		return this.t("check.detail", {
			status,
			model: check.model,
			latency,
			date: this.formatDate(check.checkedAt),
		});
	}

	private formatCodexAccount(auth: CodexAuthData | null): string {
		if (!auth) {
			return this.t("account.notSignedIn");
		}

		const identity = auth.email ?? this.compactId(auth.accountId);
		const plan = auth.planType ? this.formatPlan(auth.planType) : this.t("account.planUnknown");
		return `${this.t("account.signedInAs", { identity })} · ${this.t("account.plan", { plan })}`;
	}

	private formatLoginError(error: unknown): string {
		if (isCodexCloudflareChallengeError(error)) {
			window.open(CODEX_DEVICE_VERIFICATION_URL, "_blank", "noopener");
			return this.t("codex.cloudflare");
		}

		if (isCodexLoginAbortError(error)) {
			return this.t("codex.canceled");
		}

		console.error("Document Processing sign-in failed", error);
		return this.t("codex.failed");
	}

	private formatPlan(planType: string): string {
		return planType
			.split(/[_-]+/)
			.filter(Boolean)
			.map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
			.join(" ");
	}

	private formatDate(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return value;
		}

		return date.toLocaleString(resolveLanguage(this.plugin.settings.language));
	}

	private getLanguageLabel(language: LanguageSetting): string {
		if (language === "auto") {
			return this.t("language.auto");
		}

		if (language === "zh-CN") {
			return this.t("language.zhCN");
		}

		return this.t("language.en");
	}

	private getProviderLabel(provider: LlmProvider): string {
		if (provider === "openai-api") {
			return this.t("provider.openaiApi");
		}

		if (provider === "ollama-cloud") {
			return this.t("provider.ollamaCloud");
		}

		return this.t("provider.codexLogin");
	}

	private getTaskLabel(taskId: ProcessingTaskId): string {
		return getTaskDisplayName(this.plugin.settings.language, taskId);
	}

	private getAnkiCardLanguageLabel(language: AnkiCardLanguage): string {
		if (language === "zh-CN") {
			return this.t("anki.language.zhCN");
		}

		if (language === "en") {
			return this.t("anki.language.en");
		}

		return this.t("anki.language.matchNote");
	}

	private getReasoningEffortLabel(effort: CodexReasoningEffort): string {
		if (effort === "minimal") {
			return this.t("reasoning.minimal");
		}

		if (effort === "low") {
			return this.t("reasoning.low");
		}

		if (effort === "medium") {
			return this.t("reasoning.medium");
		}

		if (effort === "high") {
			return this.t("reasoning.high");
		}

		return this.t("reasoning.xhigh");
	}

	private getReasoningEffortDescription(effort: CodexReasoningEffort): string {
		if (effort === "minimal") {
			return this.t("reasoning.minimal.desc");
		}

		if (effort === "low") {
			return this.t("reasoning.low.desc");
		}

		if (effort === "medium") {
			return this.t("reasoning.medium.desc");
		}

		if (effort === "high") {
			return this.t("reasoning.high.desc");
		}

		return this.t("reasoning.xhigh.desc");
	}

	private getServiceTierLabel(serviceTier: CodexServiceTier): string {
		if (serviceTier === "default") {
			return this.t("speed.default");
		}

		if (serviceTier === "priority") {
			return this.t("speed.priority");
		}

		return this.t("speed.flex");
	}

	private getServiceTierDescription(serviceTier: CodexServiceTier): string {
		if (serviceTier === "default") {
			return this.t("speed.default.desc");
		}

		if (serviceTier === "priority") {
			return this.t("speed.priority.desc");
		}

		return this.t("speed.flex.desc");
	}

	private maskApiKey(apiKey: string): string {
		if (apiKey.length <= 10) {
			return "****";
		}

		return `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`;
	}

	private compactId(value: string): string {
		if (value.length <= 18) {
			return value;
		}

		return `${value.slice(0, 8)}...${value.slice(-6)}`;
	}

	private cancelActiveCodexLogin(): void {
		this.loginAbortController?.abort();
		this.loginAbortController = null;
	}

	private isActiveLogin(loginController: AbortController): boolean {
		return this.loginAbortController === loginController && !loginController.signal.aborted;
	}

	private async copyToClipboard(value: string): Promise<boolean> {
		if (!navigator.clipboard) {
			return false;
		}

		try {
			await navigator.clipboard.writeText(value);
			return true;
		} catch {
			return false;
		}
	}

	private t(key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]): string {
		return translate(this.plugin.settings.language, key, values);
	}
}

interface PromptEditModalOptions {
	title: string;
	value: string;
	saveText: string;
	cancelText: string;
	onSave: (value: string) => Promise<void>;
}

class PromptEditModal extends Modal {
	private options: PromptEditModalOptions;

	constructor(app: App, options: PromptEditModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		this.setTitle(this.options.title);
		const { contentEl } = this;
		contentEl.empty();

		const textarea = contentEl.createEl("textarea", {
			cls: "document-processing-prompt-editor",
		});
		textarea.value = this.options.value;

		new Setting(contentEl)
			.addButton((button) => button
				.setButtonText(this.options.cancelText)
				.onClick(() => {
					this.close();
				}))
			.addButton((button) => button
				.setButtonText(this.options.saveText)
				.setCta()
				.onClick(async () => {
					button.setDisabled(true);
					await this.options.onSave(textarea.value);
					this.close();
				}));

		textarea.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
