import { LanguageSetting, translate } from "../i18n";
import { ANKI_CARD_GENERATION_TASK_ID, NOTE_FORMATTING_TASK_ID, ProcessingTaskId } from "./task-ids";

export function getTaskDisplayName(language: LanguageSetting, taskId: ProcessingTaskId): string {
	if (taskId === ANKI_CARD_GENERATION_TASK_ID) {
		return translate(language, "task.ankiCardGeneration");
	}

	if (taskId === NOTE_FORMATTING_TASK_ID) {
		return translate(language, "task.noteFormatting");
	}

	return translate(language, "task.webClipperBilingualCleanup");
}
