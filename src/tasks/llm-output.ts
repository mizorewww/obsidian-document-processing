export function parseLlmJsonObject(rawText: string): unknown {
	const trimmed = rawText.trim();
	const unwrapped = unwrapCodeFence(trimmed);

	try {
		return JSON.parse(unwrapped);
	} catch {
		const start = unwrapped.indexOf("{");
		const end = unwrapped.lastIndexOf("}");
		if (start < 0 || end <= start) {
			throw new Error("LLM output is not valid JSON.");
		}

		return JSON.parse(unwrapped.slice(start, end + 1));
	}
}

export function normalizeChangeSummary(value: unknown, maxItems = 8): string[] {
	if (typeof value === "string" && value.trim()) {
		return [value.trim()];
	}

	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		.map((item) => item.trim())
		.slice(0, maxItems);
}

function unwrapCodeFence(value: string): string {
	const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(value);
	return fenceMatch?.[1] ?? value;
}
