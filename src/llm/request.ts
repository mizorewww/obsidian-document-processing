import { DocumentProcessingSettings } from "../settings-data";
import {
	getValidCodexAuth,
	refreshCodexAuth,
} from "./codex-auth";
import { CodexRequestError, requestCodexText } from "./codex-client";
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

	return requestOpenAiApiText(request);
}

async function requestOpenAiApiText(request: LlmTextRequest): Promise<LlmTextResponse> {
	const apiKey = request.settings.openaiApiKey.trim();
	const model = request.settings.openaiModel.trim();

	if (!apiKey) {
		throw new Error("OpenAI API key is missing.");
	}

	if (!model) {
		throw new Error("OpenAI model is missing.");
	}

	const response = await requestOpenAiText({
		apiKey,
		model,
		instructions: request.instructions,
		prompt: request.prompt,
		maxOutputTokens: request.maxOutputTokens,
		onProgress: request.onProgress,
		signal: request.signal,
	});

	return {
		text: response.text,
		provider: "openai-api",
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
