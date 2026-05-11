import { CodexReasoningEffort, CodexServiceTier } from "./llm/models";
import { isLanguageSetting, LanguageSetting } from "./i18n";

export type LlmProvider = "openai-api" | "codex-login";

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
	openaiModel: string;
	codexModel: string;
	codexReasoningEffort: CodexReasoningEffort;
	codexServiceTier: CodexServiceTier;
	codexAuth: CodexAuthData | null;
	lastConnectionCheck: LlmConnectionCheckRecord | null;
}

export const DEFAULT_SETTINGS: DocumentProcessingSettings = {
	language: "auto",
	llmProvider: "openai-api",
	openaiApiKey: "",
	openaiModel: "gpt-5.4-mini",
	codexModel: "gpt-5.4-mini",
	codexReasoningEffort: "medium",
	codexServiceTier: "default",
	codexAuth: null,
	lastConnectionCheck: null,
};

export function normalizeSettings(data: Partial<DocumentProcessingSettings> | null | undefined): DocumentProcessingSettings {
	const settings = Object.assign({}, DEFAULT_SETTINGS, data);
	const legacyProvider = (data as { llmProvider?: string } | null | undefined)?.llmProvider;

	if (legacyProvider === "codex-cli") {
		settings.llmProvider = "codex-login";
	}

	if (!isLanguageSetting(settings.language)) {
		settings.language = DEFAULT_SETTINGS.language;
	}

	if (!isCodexReasoningEffort(settings.codexReasoningEffort)) {
		settings.codexReasoningEffort = DEFAULT_SETTINGS.codexReasoningEffort;
	}

	if (!isCodexServiceTier(settings.codexServiceTier)) {
		settings.codexServiceTier = DEFAULT_SETTINGS.codexServiceTier;
	}

	return settings;
}

function isCodexReasoningEffort(value: unknown): value is CodexReasoningEffort {
	return value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function isCodexServiceTier(value: unknown): value is CodexServiceTier {
	return value === "default" || value === "priority" || value === "flex";
}
