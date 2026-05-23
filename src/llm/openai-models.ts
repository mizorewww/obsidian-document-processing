import { requestUrl } from "obsidian";
import { buildOpenAiApiUrl } from "./openai-client";

interface OpenAiModelsPayload {
	data?: Array<{
		id?: string;
	}>;
	error?: {
		message?: string;
		code?: string;
	};
}

export async function fetchOpenAiModels(apiKey: string, baseUrl: string): Promise<string[]> {
	const response = await requestUrl({
		url: buildOpenAiApiUrl(baseUrl, "models"),
		method: "GET",
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
		throw: false,
	});
	const payload = response.json as OpenAiModelsPayload;

	if (response.status < 200 || response.status >= 300) {
		const code = payload.error?.code ? ` (${payload.error.code})` : "";
		throw new Error(`Model list request failed with HTTP ${response.status}${code}: ${payload.error?.message ?? "The API returned an error."}`);
	}

	return [...new Set((payload.data ?? [])
		.map((model) => model.id?.trim())
		.filter((model): model is string => Boolean(model)))]
		.sort((left, right) => left.localeCompare(right));
}
