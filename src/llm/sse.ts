export type SseDataHandler = (data: string) => void;

export class StreamingUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StreamingUnavailableError";
	}
}

export function canUseFetchStreaming(): boolean {
	return typeof globalThis.fetch === "function"
		&& typeof ReadableStream !== "undefined"
		&& typeof TextDecoder !== "undefined";
}

export async function readFetchSseStream(response: Response, onData: SseDataHandler): Promise<void> {
	const body = response.body;
	if (!body) {
		throw new StreamingUnavailableError("Streaming is not available in this environment.");
	}

	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const result = await reader.read();
			if (result.done) {
				break;
			}

			buffer += decoder.decode(result.value, { stream: true });
			const consumed = consumeSseFrames(buffer);
			buffer = consumed.rest;
			for (const frame of consumed.frames) {
				emitSseFrame(frame, onData);
			}
		}
	} finally {
		reader.releaseLock();
	}

	buffer += decoder.decode();
	if (buffer.trim()) {
		emitSseFrame(buffer, onData);
	}
}

export function consumeSseFrames(buffer: string): { frames: string[]; rest: string } {
	const normalized = buffer.replace(/\r\n/gu, "\n");
	const parts = normalized.split("\n\n");
	return {
		frames: parts.slice(0, -1),
		rest: parts[parts.length - 1] ?? "",
	};
}

export function extractSseData(frame: string): string | null {
	const data = frame
		.split(/\r?\n/u)
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trimStart())
		.join("\n");

	return data || null;
}

function emitSseFrame(frame: string, onData: SseDataHandler): void {
	const data = extractSseData(frame);
	if (data) {
		onData(data);
	}
}
