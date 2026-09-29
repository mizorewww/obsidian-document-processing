import { DocumentProcessingSettings } from "../settings-data";
import {
	getValidCodexAuth,
	refreshCodexAuth,
} from "./codex-auth";
import { CodexRequestError, requestCodexText } from "./codex-client";
import { OLLAMA_CLOUD_BASE_URL } from "./ollama-cloud";
import { requestOpenAiText } from "./openai-client";
import { LlmProgressCallback, LlmTokenUsage } from "./token-usage";

export interface LlmTextRequest {
	settings: DocumentProcessingSettings;
	saveSettings: () => Promise<void>;
	instructions: string;
	prompt: string;
	maxOutputTokens?: number;
	onProgress?: LlmProgressCallback;
	signal?: AbortSignal;
}

export interface LlmTextResponse {
	text: string;
	provider: string;
	model: string;
	usage: LlmTokenUsage;
}

export async function requestLlmText(request: LlmTextRequest): Promise<LlmTextResponse> {
	if (request.settings.llmProvider === "codex-login") {
		return requestCodexLoginText(request);
	}

	if (request.settings.llmProvider === "ollama-cloud") {
		return requestApiKeyText(request, {
			apiKey: request.settings.ollamaApiKey,
			baseUrl: OLLAMA_CLOUD_BASE_URL,
			model: request.settings.ollamaModel,
			provider: "ollama-cloud",
			missingKeyMessage: "Ollama Cloud API key is missing.",
			missingModelMessage: "Ollama Cloud model is missing.",
		});
	}

	return requestApiKeyText(request, {
		apiKey: request.settings.openaiApiKey,
		baseUrl: request.settings.openaiBaseUrl,
		model: request.settings.openaiModel,
		provider: "openai-api",
		missingKeyMessage: "OpenAI API key is missing.",
		missingModelMessage: "OpenAI model is missing.",
	});
}

interface ApiKeyTextConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	provider: string;
	missingKeyMessage: string;
	missingModelMessage: string;
}

async function requestApiKeyText(request: LlmTextRequest, config: ApiKeyTextConfig): Promise<LlmTextResponse> {
	const apiKey = config.apiKey.trim();
	const model = config.model.trim();

	if (!apiKey) {
		throw new Error(config.missingKeyMessage);
	}

	if (!model) {
		throw new Error(config.missingModelMessage);
	}

	const response = await requestOpenAiText({
		apiKey,
		baseUrl: config.baseUrl,
		model,
		instructions: request.instructions,
		prompt: request.prompt,
		maxOutputTokens: request.maxOutputTokens,
		onProgress: request.onProgress,
		signal: request.signal,
	});

	return {
		text: response.text,
		provider: config.provider,
		model,
		usage: response.usage,
	};
}

async function requestCodexLoginText(request: LlmTextRequest): Promise<LlmTextResponse> {
	const model = request.settings.codexModel.trim();

	if (!model) {
		throw new Error("OpenAI account model is missing.");
	}

	const auth = await getValidCodexAuth(request.settings, request.saveSettings);
	const requestOptions = {
		instructions: request.instructions,
		reasoningEffort: request.settings.codexReasoningEffort,
		serviceTier: request.settings.codexServiceTier,
		onProgress: request.onProgress,
		signal: request.signal,
	};

	try {
		const response = await requestCodexText(model, request.prompt, auth, requestOptions);
		return {
			text: response.text,
			provider: "codex-login",
			model,
			usage: response.usage,
		};
	} catch (error) {
		if (!(error instanceof CodexRequestError) || error.status !== 401) {
			throw error;
		}

		const refreshed = await refreshCodexAuth(auth);
		request.settings.codexAuth = refreshed;
		await request.saveSettings();
		const response = await requestCodexText(model, request.prompt, refreshed, requestOptions);
		return {
			text: response.text,
			provider: "codex-login",
			model,
			usage: response.usage,
		};
	}
}
