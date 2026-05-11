import { requestUrl } from "obsidian";
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

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

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
	usage?: ApiUsagePayload;
}

interface OpenAiStreamPayload extends OpenAiResponsePayload {
	type?: string;
	delta?: string;
	response?: OpenAiResponsePayload;
	item?: {
		content?: Array<{
			text?: string;
			type?: string;
		}>;
	};
}

export interface OpenAiTextRequest {
	apiKey: string;
	model: string;
	prompt: string;
	instructions?: string;
	maxOutputTokens?: number;
	onProgress?: LlmProgressCallback;
	signal?: AbortSignal;
}

export interface OpenAiTextResponse {
	text: string;
	usage: LlmTokenUsage;
}

export class OpenAiRequestError extends Error {
	status: number;
	payload: OpenAiErrorPayload;

	constructor(status: number, message: string, payload: OpenAiErrorPayload) {
		super(message);
		this.name = "OpenAiRequestError";
		this.status = status;
		this.payload = payload;
	}
}

export async function requestOpenAiText(request: OpenAiTextRequest): Promise<OpenAiTextResponse> {
	throwIfAborted(request.signal);
	const inputTokens = estimateInputTokens(request.instructions, request.prompt);
	request.onProgress?.({
		...buildEstimatedUsage(inputTokens, ""),
		phase: "uploading",
	});

	if (request.onProgress && canUseFetchStreaming()) {
		try {
			return await requestOpenAiTextStreaming(request, inputTokens);
		} catch (error) {
			if (!(error instanceof StreamingUnavailableError)) {
				throw error;
			}
		}
	}

	return requestOpenAiTextBuffered(request, inputTokens);
}

async function requestOpenAiTextBuffered(request: OpenAiTextRequest, inputTokens: number): Promise<OpenAiTextResponse> {
	throwIfAborted(request.signal);
	request.onProgress?.({
		...buildEstimatedUsage(inputTokens, ""),
		phase: "waiting",
	});

	const response = await requestUrl({
		url: OPENAI_RESPONSES_URL,
		method: "POST",
		contentType: "application/json",
		headers: {
			Authorization: `Bearer ${request.apiKey}`,
		},
		body: JSON.stringify({
			model: request.model,
			instructions: request.instructions,
			input: request.prompt,
			max_output_tokens: request.maxOutputTokens,
			store: false,
		}),
		throw: false,
	});
	throwIfAborted(request.signal);
	const payload = response.json as OpenAiResponsePayload;

	if (response.status < 200 || response.status >= 300) {
		throw new OpenAiRequestError(response.status, formatOpenAiError(response.status, payload), payload);
	}

	const text = extractOpenAiOutputText(payload);
	const usage = usageFromApi(payload.usage) ?? buildEstimatedUsage(inputTokens, text);
	request.onProgress?.(buildProgress("completed", inputTokens, text, usage));

	return {
		text,
		usage,
	};
}

async function requestOpenAiTextStreaming(request: OpenAiTextRequest, inputTokens: number): Promise<OpenAiTextResponse> {
	let response: Response;
	try {
		response = await globalThis.fetch(OPENAI_RESPONSES_URL, {
			method: "POST",
			headers: {
				Accept: "text/event-stream",
				Authorization: `Bearer ${request.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: request.model,
				instructions: request.instructions,
				input: request.prompt,
				max_output_tokens: request.maxOutputTokens,
				store: false,
				stream: true,
			}),
			signal: request.signal,
		});
	} catch (error) {
		throw new StreamingUnavailableError(error instanceof Error ? error.message : "Streaming request failed.");
	}

	if (!response.ok) {
		const errorText = await response.text();
		const payload = parseOpenAiErrorPayload(errorText);
		throw new OpenAiRequestError(response.status, formatOpenAiError(response.status, payload), payload);
	}

	let streamedText = "";
	let completedText = "";
	let usage: LlmTokenUsage | undefined;

	await readFetchSseStream(response, (data) => {
		throwIfAborted(request.signal);
		if (data === "[DONE]") {
			return;
		}

		const payload = JSON.parse(data) as OpenAiStreamPayload;
		const error = payload.error;
		if (error?.message) {
			throw new OpenAiRequestError(response.status, error.message, payload);
		}

		const delta = extractOpenAiStreamDelta(payload);
		if (delta) {
			streamedText += delta;
			request.onProgress?.(buildProgress("streaming", inputTokens, streamedText));
		}

		const responseText = payload.response ? extractOpenAiOutputText(payload.response) : "";
		if (responseText) {
			completedText = responseText;
		}

		usage = usageFromApi(payload.response?.usage ?? payload.usage) ?? usage;
	});

	const text = completedText || streamedText;
	throwIfAborted(request.signal);
	const finalUsage = usage ?? buildEstimatedUsage(inputTokens, text);
	request.onProgress?.(buildProgress("completed", inputTokens, text, finalUsage));

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

function formatOpenAiError(status: number, payload: OpenAiResponsePayload): string {
	const message = payload.error?.message ?? "The OpenAI API returned an error.";
	const code = payload.error?.code ? ` (${payload.error.code})` : "";
	return `OpenAI API request failed with HTTP ${status}${code}: ${message}`;
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

function extractOpenAiStreamDelta(payload: OpenAiStreamPayload): string {
	if (typeof payload.delta === "string") {
		return payload.delta;
	}

	const outputParts: string[] = [];
	for (const content of payload.item?.content ?? []) {
		if (typeof content.text === "string") {
			outputParts.push(content.text);
		}
	}

	return outputParts.join("\n");
}

function parseOpenAiErrorPayload(text: string): OpenAiErrorPayload {
	try {
		const parsed = JSON.parse(text) as OpenAiErrorPayload;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}
