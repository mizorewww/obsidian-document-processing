export type LlmProgressPhase = "uploading" | "waiting" | "streaming" | "completed";

export interface LlmTokenUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens?: number;
	inputTokensEstimated: boolean;
	outputTokensEstimated: boolean;
}

export interface LlmProgressUpdate extends LlmTokenUsage {
	phase: LlmProgressPhase;
}

export type LlmProgressCallback = (progress: LlmProgressUpdate) => void;

export interface ApiUsagePayload {
	input_tokens?: number;
	output_tokens?: number;
	total_tokens?: number;
}

export function estimateTokens(text: string): number {
	const trimmed = text.trim();
	if (!trimmed) {
		return 0;
	}

	let cjkCharacters = 0;
	let otherCharacters = 0;
	for (const character of trimmed) {
		if (/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(character)) {
			cjkCharacters += 1;
		} else if (!/\s/u.test(character)) {
			otherCharacters += 1;
		}
	}

	return Math.max(1, Math.ceil(cjkCharacters + (otherCharacters / 4)));
}

export function estimateInputTokens(instructions: string | undefined, prompt: string): number {
	return estimateTokens(`${instructions ?? ""}\n\n${prompt}`);
}

export function buildEstimatedUsage(inputTokens: number, outputText: string): LlmTokenUsage {
	const outputTokens = estimateTokens(outputText);
	return {
		inputTokens,
		outputTokens,
		totalTokens: inputTokens + outputTokens,
		inputTokensEstimated: true,
		outputTokensEstimated: true,
	};
}

export function usageFromApi(payload: ApiUsagePayload | undefined): LlmTokenUsage | undefined {
	const rawInputTokens = payload?.input_tokens;
	const rawOutputTokens = payload?.output_tokens;
	const rawTotalTokens = payload?.total_tokens;

	if (
		typeof rawInputTokens !== "number"
		|| typeof rawOutputTokens !== "number"
		|| !Number.isFinite(rawInputTokens)
		|| !Number.isFinite(rawOutputTokens)
	) {
		return undefined;
	}

	const inputTokens = Math.max(0, Math.round(rawInputTokens));
	const outputTokens = Math.max(0, Math.round(rawOutputTokens));
	const totalTokens = typeof rawTotalTokens === "number" && Number.isFinite(rawTotalTokens)
		? Math.max(0, Math.round(rawTotalTokens))
		: inputTokens + outputTokens;

	return {
		inputTokens,
		outputTokens,
		totalTokens,
		inputTokensEstimated: false,
		outputTokensEstimated: false,
	};
}

export function buildProgress(
	phase: LlmProgressPhase,
	inputTokens: number,
	outputText: string,
	usage?: LlmTokenUsage,
): LlmProgressUpdate {
	if (usage) {
		return {
			...usage,
			phase,
		};
	}

	return {
		...buildEstimatedUsage(inputTokens, outputText),
		phase,
	};
}
