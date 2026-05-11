import { requestUrl } from "obsidian";
import { CodexAuthData } from "../settings-data";
import { CodexReasoningEffort, CodexServiceTier } from "./models";
import { CODEX_ORIGINATOR, CODEX_RESPONSES_URL, CODEX_VERSION, getCodexUserAgent } from "./codex-auth";

interface OpenAiResponsePayload {
	output_text?: string;
	output?: Array<{
		content?: Array<{
			text?: string;
			type?: string;
		}>;
		type?: string;
	}>;
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
): Promise<string> {
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
		body: JSON.stringify({
			model,
			instructions: "You are a concise assistant.",
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
		}),
		throw: false,
	});

	if (response.status < 200 || response.status >= 300) {
		throw new CodexRequestError(response.status, formatCodexError(response.status, response.text, response.json as CodexErrorPayload));
	}

	return extractCodexSseOutputText(response.text);
}

function formatCodexError(status: number, text: string, payload: CodexErrorPayload): string {
	const message = payload.detail || payload.error?.message || text || "Codex returned an error.";
	return `Codex request failed with HTTP ${status}: ${message}`;
}

function extractCodexSseOutputText(text: string): string {
	const completedItems: string[] = [];
	const deltas: string[] = [];
	const events = text.split(/\n\n+/);

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
			}

			const itemText = extractOutputItemText(payload);
			if (itemText) {
				completedItems.push(itemText);
			}

			const responseText = payload.response ? extractOpenAiOutputText(payload.response) : "";
			if (responseText) {
				completedItems.push(responseText);
			}
		} catch {
			// Ignore malformed event frames and keep scanning the completed stream.
		}
	}

	return completedItems[completedItems.length - 1] ?? deltas.join("");
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
