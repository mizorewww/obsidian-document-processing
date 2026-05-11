import { requestUrl } from "obsidian";
import {
	getValidCodexAuth,
	refreshCodexAuth,
} from "./codex-auth";
import { CodexRequestError, requestCodexText } from "./codex-client";
import { DocumentProcessingSettings } from "../settings-data";
import { translate } from "../i18n";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const TEST_PROMPT = "Reply with exactly: ok";

export interface LlmCheckResult {
	ok: boolean;
	provider: string;
	model: string;
	message: string;
	latencyMs: number;
	output: string;
}

interface OpenAiErrorPayload {
	error?: {
		message?: string;
		type?: string;
		code?: string;
	};
}

interface OpenAiResponsePayload extends OpenAiErrorPayload {
	output_text?: string;
	output?: Array<{
		content?: Array<{
			text?: string;
			type?: string;
		}>;
		type?: string;
	}>;
}

export async function checkLlmConnection(
	settings: DocumentProcessingSettings,
	saveSettings: () => Promise<void>,
): Promise<LlmCheckResult> {
	if (settings.llmProvider === "codex-login") {
		return checkCodexLogin(settings, saveSettings);
	}

	return checkOpenAiApi(settings);
}

async function checkOpenAiApi(settings: DocumentProcessingSettings): Promise<LlmCheckResult> {
	const apiKey = settings.openaiApiKey.trim();
	const model = settings.openaiModel.trim();

	if (!apiKey) {
		throw new Error(translate(settings.language, "check.error.missingApiKey"));
	}

	if (!model) {
		throw new Error(translate(settings.language, "check.error.missingOpenAiModel"));
	}

	const startedAt = Date.now();
	const response = await requestUrl({
		url: OPENAI_RESPONSES_URL,
		method: "POST",
		contentType: "application/json",
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model,
			input: TEST_PROMPT,
			max_output_tokens: 16,
			store: false,
		}),
		throw: false,
	});
	const latencyMs = Date.now() - startedAt;
	const payload = response.json as OpenAiResponsePayload;

	if (response.status < 200 || response.status >= 300) {
		throw new Error(formatOpenAiError(response.status, payload, settings));
	}

	const output = extractOpenAiOutputText(payload);
	return buildResult(translate(settings.language, "provider.openaiApi"), model, output, latencyMs, settings);
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
		return buildResult(translate(settings.language, "provider.codexLogin"), model, output, Date.now() - startedAt, settings);
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
		return buildResult(translate(settings.language, "provider.codexLogin"), model, output, Date.now() - startedAt, settings);
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

function formatOpenAiError(status: number, payload: OpenAiResponsePayload, settings: DocumentProcessingSettings): string {
	const error = payload.error;
	const message = error?.message ?? translate(settings.language, "check.error.openAiDefault");
	const code = error?.code ? ` (${error.code})` : "";
	return translate(settings.language, "check.error.openAiHttp", { status, code, message });
}

function extractOpenAiOutputText(payload: OpenAiResponsePayload): string {
	if (typeof payload.output_text === "string") {
		return payload.output_text;
	}

	const outputParts: string[] = [];
	for (const item of payload.output ?? []) {
		for (const content of item.content ?? []) {
			if (typeof content.text === "string") {
				outputParts.push(content.text);
			}
		}
	}

	return outputParts.join("\n");
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
