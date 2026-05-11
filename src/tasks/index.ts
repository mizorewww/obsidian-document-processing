import { ProcessingTaskId } from "./task-ids";
import { TaskDefinition } from "./types";
import { ANKI_CARD_GENERATION_TASK } from "./anki-card-generation";
import { WEB_CLIPPER_BILINGUAL_CLEANUP_TASK } from "./web-clipper-bilingual-cleanup";

export const TASK_DEFINITIONS: TaskDefinition[] = [
	WEB_CLIPPER_BILINGUAL_CLEANUP_TASK,
	ANKI_CARD_GENERATION_TASK,
];

export function getTaskDefinition(taskId: ProcessingTaskId): TaskDefinition {
	return TASK_DEFINITIONS.find((task) => task.id === taskId) ?? WEB_CLIPPER_BILINGUAL_CLEANUP_TASK;
}
