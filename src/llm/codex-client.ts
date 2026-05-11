import { requestUrl } from "obsidian";
import { CodexAuthData } from "../settings-data";
import { CodexReasoningEffort, CodexServiceTier } from "./models";
import { CODEX_ORIGINATOR, CODEX_RESPONSES_URL, CODEX_VERSION, getCodexUserAgent } from "./codex-auth";
import { canUseFetchStreaming, readFetchSseStream, StreamingUnavailableError } from "./sse";
import {
	ApiUsagePayload,
	buildEstimatedUsage,
	buildProgress,
	estimateInputTokens,
	LlmProgressCallback,
	LlmTokenUsage,
	usageFromApi,
} from "./token-usage";

interface OpenAiResponsePayload {
	output_text?: string;
	output?: Array<{
		content?: Array<{
			text?: string;
			type?: string;
		}>;
		type?: string;
	}>;
	usage?: ApiUsagePayload;
}

interface CodexErrorPayload {
	detail?: string;
	error?: {
		message?: string;
		type?: string;
		code?: string;
	};
}

interface CodexSsePayload {
	type?: string;
	delta?: string;
	usage?: ApiUsagePayload;
	item?: {
		content?: Array<{
			text?: string;
			type?: string;
		}>;
	};
	response?: OpenAiResponsePayload;
}

export interface CodexRequestOptions {
	reasoningEffort: CodexReasoningEffort;
	serviceTier: CodexServiceTier;
	instructions?: string;
	onProgress?: LlmProgressCallback;
	signal?: AbortSignal;
}

export interface CodexTextResponse {
	text: string;
	usage: LlmTokenUsage;
}

export class CodexRequestError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "CodexRequestError";
		this.status = status;
	}
}

export async function requestCodexText(
	model: string,
	prompt: string,
	auth: CodexAuthData,
	options: CodexRequestOptions,
): Promise<CodexTextResponse> {
	throwIfAborted(options.signal);
	const inputTokens = estimateInputTokens(options.instructions, prompt);
	options.onProgress?.({
		...buildEstimatedUsage(inputTokens, ""),
		phase: "uploading",
	});

	if (options.onProgress && canUseFetchStreaming()) {
		try {
			return await requestCodexTextStreaming(model, prompt, auth, options, inputTokens);
		} catch (error) {
			if (!(error instanceof StreamingUnavailableError)) {
				throw error;
			}
		}
	}

	return requestCodexTextBuffered(model, prompt, auth, options, inputTokens);
}

async function requestCodexTextBuffered(
	model: string,
	prompt: string,
	auth: CodexAuthData,
	options: CodexRequestOptions,
	inputTokens: number,
): Promise<CodexTextResponse> {
	throwIfAborted(options.signal);
	options.onProgress?.({
		...buildEstimatedUsage(inputTokens, ""),
		phase: "waiting",
	});

	const response = await requestUrl({
		url: CODEX_RESPONSES_URL,
		method: "POST",
		contentType: "application/json",
		headers: {
			Accept: "text/event-stream",
			Authorization: `Bearer ${auth.accessToken}`,
			"ChatGPT-Account-ID": auth.accountId,
			"User-Agent": getCodexUserAgent(),
			originator: CODEX_ORIGINATOR,
			version: CODEX_VERSION,
		},
		body: JSON.stringify(buildCodexRequestBody(model, prompt, options)),
		throw: false,
	});
	throwIfAborted(options.signal);

	if (response.status < 200 || response.status >= 300) {
		throw new CodexRequestError(response.status, formatCodexError(response.status, response.text, response.json as CodexErrorPayload));
	}

	const result = extractCodexSseOutput(response.text, inputTokens, options.onProgress);
	options.onProgress?.(buildProgress("completed", inputTokens, result.text, result.usage));
	return result;
}

async function requestCodexTextStreaming(
	model: string,
	prompt: string,
	auth: CodexAuthData,
	options: CodexRequestOptions,
	inputTokens: number,
): Promise<CodexTextResponse> {
	let response: Response;
	try {
		response = await globalThis.fetch(CODEX_RESPONSES_URL, {
			method: "POST",
			headers: {
				Accept: "text/event-stream",
				Authorization: `Bearer ${auth.accessToken}`,
				"ChatGPT-Account-ID": auth.accountId,
				"Content-Type": "application/json",
				"User-Agent": getCodexUserAgent(),
				originator: CODEX_ORIGINATOR,
				version: CODEX_VERSION,
			},
			body: JSON.stringify(buildCodexRequestBody(model, prompt, options)),
			signal: options.signal,
		});
	} catch (error) {
		throw new StreamingUnavailableError(error instanceof Error ? error.message : "Streaming request failed.");
	}

	if (!response.ok) {
		const text = await response.text();
		throw new CodexRequestError(response.status, formatCodexError(response.status, text, parseCodexErrorPayload(text)));
	}

	const result = readCodexStream(response, inputTokens, options);
	return result;
}

function formatCodexError(status: number, text: string, payload: CodexErrorPayload): string {
	const message = payload.detail || payload.error?.message || text || "Codex returned an error.";
	return `Codex request failed with HTTP ${status}: ${message}`;
}

function extractCodexSseOutput(
	text: string,
	inputTokens: number,
	onProgress?: LlmProgressCallback,
): CodexTextResponse {
	const completedItems: string[] = [];
	const deltas: string[] = [];
	const events = text.split(/\n\n+/);
	let usage: LlmTokenUsage | undefined;

	for (const event of events) {
		const data = event
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.join("\n");

		if (!data || data === "[DONE]") {
			continue;
		}

		try {
			const payload = JSON.parse(data) as CodexSsePayload;
			if (typeof payload.delta === "string") {
				deltas.push(payload.delta);
				onProgress?.(buildProgress("streaming", inputTokens, deltas.join("")));
			}

			const itemText = extractOutputItemText(payload);
			if (itemText) {
				completedItems.push(itemText);
			}

			const responseText = payload.response ? extractOpenAiOutputText(payload.response) : "";
			if (responseText) {
				completedItems.push(responseText);
			}

			usage = usageFromApi(payload.response?.usage ?? payload.usage) ?? usage;
		} catch {
			// Ignore malformed event frames and keep scanning the completed stream.
		}
	}

	const outputText = completedItems[completedItems.length - 1] ?? deltas.join("");
	return {
		text: outputText,
		usage: usage ?? buildEstimatedUsage(inputTokens, outputText),
	};
}

async function readCodexStream(
	response: Response,
	inputTokens: number,
	options: CodexRequestOptions,
): Promise<CodexTextResponse> {
	let streamedText = "";
	let completedText = "";
	let usage: LlmTokenUsage | undefined;

	await readFetchSseStream(response, (data) => {
		throwIfAborted(options.signal);
		if (data === "[DONE]") {
			return;
		}

		const payload = JSON.parse(data) as CodexSsePayload;
		if (typeof payload.delta === "string") {
			streamedText += payload.delta;
			options.onProgress?.(buildProgress("streaming", inputTokens, streamedText));
		}

		const itemText = extractOutputItemText(payload);
		if (itemText) {
			completedText = itemText;
		}

		const responseText = payload.response ? extractOpenAiOutputText(payload.response) : "";
		if (responseText) {
			completedText = responseText;
		}

		usage = usageFromApi(payload.response?.usage ?? payload.usage) ?? usage;
	});

	const text = completedText || streamedText;
	throwIfAborted(options.signal);
	const finalUsage = usage ?? buildEstimatedUsage(inputTokens, text);
	options.onProgress?.(buildProgress("completed", inputTokens, text, finalUsage));

	return {
		text,
		usage: finalUsage,
	};
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new Error("Processing queue canceled.");
	}
}

function extractOutputItemText(payload: CodexSsePayload): string {
	const outputParts: string[] = [];

	for (const content of payload.item?.content ?? []) {
		if (typeof content.text === "string") {
			outputParts.push(content.text);
		}
	}

	return outputParts.join("\n");
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

function buildCodexRequestBody(model: string, prompt: string, options: CodexRequestOptions): Record<string, unknown> {
	return {
		model,
		instructions: options.instructions ?? "You are a concise assistant.",
		input: [
			{
				role: "user",
				content: [
					{
						type: "input_text",
						text: prompt,
					},
				],
			},
		],
		tools: [],
		tool_choice: "auto",
		parallel_tool_calls: false,
		reasoning: {
			effort: options.reasoningEffort,
			summary: "auto",
		},
		include: ["reasoning.encrypted_content"],
		store: false,
		service_tier: options.serviceTier === "default" ? undefined : options.serviceTier,
		stream: true,
	};
}

function parseCodexErrorPayload(text: string): CodexErrorPayload {
	try {
		const parsed = JSON.parse(text) as CodexErrorPayload;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}
