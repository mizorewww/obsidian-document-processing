export type ProcessingTaskId = "web-clipper-bilingual-cleanup" | "note-formatting" | "anki-card-generation";

export const DEFAULT_PROCESSING_TASK_ID: ProcessingTaskId = "web-clipper-bilingual-cleanup";

const PROCESSING_TASK_IDS = new Set<string>([
	"web-clipper-bilingual-cleanup",
	"note-formatting",
	"anki-card-generation",
]);

export function isProcessingTaskId(value: unknown): value is ProcessingTaskId {
	return typeof value === "string" && PROCESSING_TASK_IDS.has(value);
}
