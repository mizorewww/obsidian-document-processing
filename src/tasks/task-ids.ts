export type ProcessingTaskId = "web-clipper-bilingual-cleanup" | "note-formatting" | "anki-card-generation";

export const DEFAULT_PROCESSING_TASK_ID: ProcessingTaskId = "web-clipper-bilingual-cleanup";
export const NOTE_FORMATTING_TASK_ID: ProcessingTaskId = "note-formatting";
export const ANKI_CARD_GENERATION_TASK_ID: ProcessingTaskId = "anki-card-generation";

const PROCESSING_TASK_IDS = new Set<string>([
	DEFAULT_PROCESSING_TASK_ID,
	NOTE_FORMATTING_TASK_ID,
	ANKI_CARD_GENERATION_TASK_ID,
]);

export function isProcessingTaskId(value: unknown): value is ProcessingTaskId {
	return typeof value === "string" && PROCESSING_TASK_IDS.has(value);
}
