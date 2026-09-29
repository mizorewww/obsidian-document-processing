import { CodexReasoningEffort, CodexServiceTier } from "./llm/models";
import { isLanguageSetting, LanguageSetting } from "./i18n";
import { DEFAULT_TASK_BINDINGS, normalizeTaskBindings, TaskBinding } from "./tasks/bindings";

export type LlmProvider = "openai-api" | "codex-login" | "ollama-cloud";
export type AnkiCardLanguage = "zh-CN" | "en" | "match-note";

export interface CodexAuthData {
	idToken: string;
	accessToken: string;
	refreshToken: string;
	accountId: string;
	email?: string;
	planType?: string;
	expiresAt?: number;
	lastRefresh?: string;
}

export interface LlmConnectionCheckRecord {
	provider: LlmProvider;
	model: string;
	ok: boolean;
	message: string;
	checkedAt: string;
	latencyMs?: number;
}

export interface DocumentProcessingSettings {
	language: LanguageSetting;
	llmProvider: LlmProvider;
	openaiApiKey: string;
	openaiBaseUrl: string;
	openaiModel: string;
	openaiAvailableModels: string[];
	ollamaApiKey: string;
	ollamaModel: string;
	ollamaAvailableModels: string[];
	codexModel: string;
	codexReasoningEffort: CodexReasoningEffort;
	codexServiceTier: CodexServiceTier;
	taskBindings: TaskBinding[];
	ankiCardLanguage: AnkiCardLanguage;
	cacheRetentionLimit: number;
	showCompletionNotice: boolean;
	codexAuth: CodexAuthData | null;
	lastConnectionCheck: LlmConnectionCheckRecord | null;
}

export const DEFAULT_SETTINGS: DocumentProcessingSettings = {
	language: "auto",
	llmProvider: "openai-api",
	openaiApiKey: "",
	openaiBaseUrl: "https://api.openai.com/v1",
	openaiModel: "gpt-5.4-mini",
	openaiAvailableModels: [],
	ollamaApiKey: "",
	ollamaModel: "gpt-oss:120b",
	ollamaAvailableModels: [],
	codexModel: "gpt-5.4-mini",
	codexReasoningEffort: "medium",
	codexServiceTier: "default",
	taskBindings: DEFAULT_TASK_BINDINGS,
	ankiCardLanguage: "zh-CN",
	cacheRetentionLimit: 20,
	showCompletionNotice: true,
	codexAuth: null,
	lastConnectionCheck: null,
};

export function normalizeSettings(data: Partial<DocumentProcessingSettings> | null | undefined): DocumentProcessingSettings {
	const settings = Object.assign({}, DEFAULT_SETTINGS, data);
	const legacyProvider = (data as { llmProvider?: string } | null | undefined)?.llmProvider;

	if (legacyProvider === "codex-cli") {
		settings.llmProvider = "codex-login";
	}

	if (!isLlmProvider(settings.llmProvider)) {
		settings.llmProvider = DEFAULT_SETTINGS.llmProvider;
	}

	if (!isLanguageSetting(settings.language)) {
		settings.language = DEFAULT_SETTINGS.language;
	}

	if (typeof settings.openaiBaseUrl !== "string" || !settings.openaiBaseUrl.trim()) {
		settings.openaiBaseUrl = DEFAULT_SETTINGS.openaiBaseUrl;
	}

	if (!Array.isArray(settings.openaiAvailableModels)) {
		settings.openaiAvailableModels = [];
	}

	settings.openaiAvailableModels = settings.openaiAvailableModels
		.filter((model): model is string => typeof model === "string" && Boolean(model.trim()))
		.map((model) => model.trim());

	if (typeof settings.ollamaApiKey !== "string") {
		settings.ollamaApiKey = "";
	}

	if (typeof settings.ollamaModel !== "string" || !settings.ollamaModel.trim()) {
		settings.ollamaModel = DEFAULT_SETTINGS.ollamaModel;
	}

	if (!Array.isArray(settings.ollamaAvailableModels)) {
		settings.ollamaAvailableModels = [];
	}

	settings.ollamaAvailableModels = settings.ollamaAvailableModels
		.filter((model): model is string => typeof model === "string" && Boolean(model.trim()))
		.map((model) => model.trim());

	if (!isCodexReasoningEffort(settings.codexReasoningEffort)) {
		settings.codexReasoningEffort = DEFAULT_SETTINGS.codexReasoningEffort;
	}

	if (!isCodexServiceTier(settings.codexServiceTier)) {
		settings.codexServiceTier = DEFAULT_SETTINGS.codexServiceTier;
	}

	settings.taskBindings = normalizeTaskBindings(settings.taskBindings);
	applyLegacyAutoProcessingSetting(data, settings.taskBindings);

	if (!isAnkiCardLanguage(settings.ankiCardLanguage)) {
		settings.ankiCardLanguage = DEFAULT_SETTINGS.ankiCardLanguage;
	}

	if (!Number.isFinite(settings.cacheRetentionLimit) || settings.cacheRetentionLimit < 1) {
		settings.cacheRetentionLimit = DEFAULT_SETTINGS.cacheRetentionLimit;
	}

	settings.cacheRetentionLimit = Math.round(settings.cacheRetentionLimit);
	settings.showCompletionNotice = settings.showCompletionNotice === true;

	return settings;
}

function isLlmProvider(value: unknown): value is LlmProvider {
	return value === "openai-api" || value === "codex-login" || value === "ollama-cloud";
}

function isCodexReasoningEffort(value: unknown): value is CodexReasoningEffort {
	return value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function isCodexServiceTier(value: unknown): value is CodexServiceTier {
	return value === "default" || value === "priority" || value === "flex";
}

function isAnkiCardLanguage(value: unknown): value is AnkiCardLanguage {
	return value === "zh-CN" || value === "en" || value === "match-note";
}

function applyLegacyAutoProcessingSetting(
	data: Partial<DocumentProcessingSettings> | null | undefined,
	bindings: TaskBinding[],
): void {
	const raw = data as {
		autoProcessingEnabled?: unknown;
		taskBindings?: unknown;
	} | null | undefined;
	const hasNewAutoProcess = Array.isArray(raw?.taskBindings)
		&& raw.taskBindings.some((binding) => Boolean(binding)
			&& typeof binding === "object"
			&& typeof (binding as { autoProcess?: unknown }).autoProcess === "boolean");

	if (hasNewAutoProcess || typeof raw?.autoProcessingEnabled !== "boolean") {
		return;
	}

	for (const binding of bindings) {
		binding.autoProcess = raw.autoProcessingEnabled && binding.autoProcess;
	}
}
