import {
	getValidCodexAuth,
	refreshCodexAuth,
} from "./codex-auth";
import { CodexRequestError, requestCodexText } from "./codex-client";
import { OLLAMA_CLOUD_BASE_URL } from "./ollama-cloud";
import { DocumentProcessingSettings } from "../settings-data";
import { translate } from "../i18n";
import { OpenAiRequestError, requestOpenAiText } from "./openai-client";

const TEST_PROMPT = "Reply with exactly: ok";

export interface LlmCheckResult {
	ok: boolean;
	provider: string;
	model: string;
	message: string;
	latencyMs: number;
	output: string;
}

export async function checkLlmConnection(
	settings: DocumentProcessingSettings,
	saveSettings: () => Promise<void>,
): Promise<LlmCheckResult> {
	if (settings.llmProvider === "codex-login") {
		return checkCodexLogin(settings, saveSettings);
	}

	if (settings.llmProvider === "ollama-cloud") {
		return checkApiKeyProvider(settings, {
			apiKey: settings.ollamaApiKey,
			baseUrl: OLLAMA_CLOUD_BASE_URL,
			model: settings.ollamaModel,
			providerLabel: translate(settings.language, "provider.ollamaCloud"),
			missingKeyError: translate(settings.language, "check.error.missingOllamaKey"),
			missingModelError: translate(settings.language, "check.error.missingOllamaModel"),
			maxOutputTokens: 256,
		});
	}

	return checkApiKeyProvider(settings, {
		apiKey: settings.openaiApiKey,
		baseUrl: settings.openaiBaseUrl,
		model: settings.openaiModel,
		providerLabel: translate(settings.language, "provider.openaiApi"),
		missingKeyError: translate(settings.language, "check.error.missingApiKey"),
		missingModelError: translate(settings.language, "check.error.missingOpenAiModel"),
		maxOutputTokens: 16,
	});
}

interface ApiKeyCheckConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	providerLabel: string;
	missingKeyError: string;
	missingModelError: string;
	maxOutputTokens: number;
}

async function checkApiKeyProvider(settings: DocumentProcessingSettings, config: ApiKeyCheckConfig): Promise<LlmCheckResult> {
	const apiKey = config.apiKey.trim();
	const model = config.model.trim();

	if (!apiKey) {
		throw new Error(config.missingKeyError);
	}

	if (!model) {
		throw new Error(config.missingModelError);
	}

	const startedAt = Date.now();
	try {
		const response = await requestOpenAiText({
			apiKey,
			baseUrl: config.baseUrl,
			model,
			prompt: TEST_PROMPT,
			maxOutputTokens: config.maxOutputTokens,
		});
		return buildResult(config.providerLabel, model, response.text, Date.now() - startedAt, settings);
	} catch (error) {
		if (error instanceof OpenAiRequestError) {
			throw new Error(formatOpenAiError(error.status, error.payload, settings));
		}

		throw error;
	}
}

async function checkCodexLogin(
	settings: DocumentProcessingSettings,
	saveSettings: () => Promise<void>,
): Promise<LlmCheckResult> {
	const model = settings.codexModel.trim();

	if (!model) {
		throw new Error(translate(settings.language, "check.error.missingCodexModel"));
	}

	if (!settings.codexAuth) {
		throw new Error(translate(settings.language, "check.error.notSignedIn"));
	}

	const auth = await getCodexAuthForCheck(settings, saveSettings);
	const startedAt = Date.now();
	const requestOptions = {
		reasoningEffort: settings.codexReasoningEffort,
		serviceTier: settings.codexServiceTier,
	};

	try {
		const output = await requestCodexText(model, TEST_PROMPT, auth, requestOptions);
		return buildResult(translate(settings.language, "provider.codexLogin"), model, output.text, Date.now() - startedAt, settings);
	} catch (error) {
		if (!(error instanceof CodexRequestError) || error.status !== 401) {
			if (error instanceof CodexRequestError) {
				throw new Error(translate(settings.language, "check.error.modelHttp", {
					status: error.status,
					message: cleanCodexRequestMessage(error.message),
				}));
			}

			throw error;
		}

		const refreshed = await refreshCodexAuth(auth);
		settings.codexAuth = refreshed;
		await saveSettings();
		const output = await requestCodexText(model, TEST_PROMPT, refreshed, requestOptions);
		return buildResult(translate(settings.language, "provider.codexLogin"), model, output.text, Date.now() - startedAt, settings);
	}
}

async function getCodexAuthForCheck(
	settings: DocumentProcessingSettings,
	saveSettings: () => Promise<void>,
) {
	try {
		return await getValidCodexAuth(settings, saveSettings);
	} catch (error) {
		console.error("Document Processing account check failed", error);
		throw new Error(translate(settings.language, "check.error.signInUnavailable"));
	}
}

function cleanCodexRequestMessage(message: string): string {
	return message.replace(/^Codex request failed with HTTP \d+:\s*/u, "");
}

function formatOpenAiError(status: number, payload: { error?: { message?: string; code?: string } }, settings: DocumentProcessingSettings): string {
	const error = payload.error;
	const message = error?.message ?? translate(settings.language, "check.error.openAiDefault");
	const code = error?.code ? ` (${error.code})` : "";
	return translate(settings.language, "check.error.openAiHttp", { status, code, message });
}

function buildResult(
	provider: string,
	model: string,
	output: string,
	latencyMs: number,
	settings: DocumentProcessingSettings,
): LlmCheckResult {
	const normalizedOutput = output.trim();
	const ok = /^ok[.!]?$/i.test(normalizedOutput);

	if (!ok) {
		throw new Error(translate(settings.language, "check.error.unexpectedOutput", {
			provider,
			output: normalizedOutput || translate(settings.language, "check.emptyOutput"),
		}));
	}

	return {
		ok,
		provider,
		model,
		message: translate(settings.language, "check.success", { provider, model, latency: latencyMs }),
		latencyMs,
		output: normalizedOutput,
	};
}
