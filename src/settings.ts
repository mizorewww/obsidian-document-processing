import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type DocumentProcessingPlugin from "./main";
import { translate, LanguageSetting, resolveLanguage } from "./i18n";
import { checkLlmConnection } from "./llm/check";
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
	OPENAI_API_MODELS,
} from "./llm/models";
import { CodexAuthData, LlmConnectionCheckRecord, LlmProvider } from "./settings-data";

const LANGUAGE_SETTINGS: LanguageSetting[] = ["auto", "zh-CN", "en"];
const PROVIDERS: LlmProvider[] = ["openai-api", "codex-login"];

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
		const options = this.plugin.settings.llmProvider === "codex-login" ? CODEX_MODELS : OPENAI_API_MODELS;

		this.addModelSetting({
			containerEl: sectionEl,
			model: this.getCurrentModel(),
			options,
			onChange: async (model) => {
				if (this.plugin.settings.llmProvider === "codex-login") {
					this.plugin.settings.codexModel = model;
				} else {
					this.plugin.settings.openaiModel = model;
				}
				await this.plugin.saveSettings();
			},
		});

		if (this.plugin.settings.llmProvider === "codex-login") {
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
			.setDesc(this.t("model.desc"))
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
			.addText((text) => text
				.setPlaceholder(this.t("model.custom.placeholder"))
				.onChange(async (value) => {
					const model = value.trim();
					if (!model) {
						return;
					}

					await config.onChange(model);
				}));
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
		return this.plugin.settings.llmProvider === "codex-login"
			? this.plugin.settings.codexModel
			: this.plugin.settings.openaiModel;
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

		return this.t("provider.codexLogin");
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
