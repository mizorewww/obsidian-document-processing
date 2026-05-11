import ankiSyncRules from "./prompts/anki/anki-sync-rules.md";
import cardExamples from "./prompts/anki/card-examples.md";
import cardWritingGuide from "./prompts/anki/card-writing-guide.md";
import outputContract from "./prompts/anki/output-contract.md";
import { TaskReferenceFile } from "./types";

export const ANKI_REFERENCE_PROMPT_FILES: TaskReferenceFile[] = [
	{
		path: "prompts/anki/anki-sync-rules.md",
		content: ankiSyncRules,
	},
	{
		path: "prompts/anki/card-writing-guide.md",
		content: cardWritingGuide,
	},
	{
		path: "prompts/anki/card-examples.md",
		content: cardExamples,
	},
	{
		path: "prompts/anki/output-contract.md",
		content: outputContract,
	},
];
