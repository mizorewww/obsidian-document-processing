export const LLM_CANCELED_MESSAGE = "Processing queue canceled.";

export function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new Error(LLM_CANCELED_MESSAGE);
	}
}

export function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}
