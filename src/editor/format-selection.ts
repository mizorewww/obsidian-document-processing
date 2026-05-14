import type { Editor, EditorPosition } from "obsidian";
import { requestLlmText } from "../llm/request";
import { LlmProgressCallback, LlmTokenUsage } from "../llm/token-usage";
import { DocumentProcessingSettings } from "../settings-data";

const FORMAT_SELECTION_INSTRUCTIONS = [
	"You format selected Obsidian Markdown text.",
	"Return only the replacement Markdown for the selected text.",
	"Do not wrap the whole answer in a code fence.",
	"Do not add frontmatter, summaries, translations, or facts that are not already present.",
	"Keep the original language, meaning, links, embeds, code blocks, callouts, math, and important structure.",
	"Improve Markdown spacing, heading levels inside the selection, lists, tables, quote formatting, and paragraph breaks.",
].join("\n");

interface SelectionSnapshot {
	from: EditorPosition;
	to: EditorPosition;
	text: string;
}

export interface FormatSelectionOptions {
	editor: Editor;
	settings: DocumentProcessingSettings;
	saveSettings: () => Promise<void>;
	onProgress?: LlmProgressCallback;
	signal?: AbortSignal;
}

export interface FormatSelectionResult {
	formattedText: string;
	tokenUsage: LlmTokenUsage;
}

export class SelectionChangedError extends Error {
	constructor() {
		super("The selected text changed while the model was working.");
		this.name = "SelectionChangedError";
	}
}

export function hasEditorSelection(editor: Editor): boolean {
	return editor.getSelection().trim().length > 0;
}

export async function formatSelectedMarkdown(options: FormatSelectionOptions): Promise<FormatSelectionResult> {
	const snapshot = getSelectionSnapshot(options.editor);
	if (!snapshot.text.trim()) {
		throw new Error("No text is selected.");
	}

	const response = await requestLlmText({
		settings: options.settings,
		saveSettings: options.saveSettings,
		instructions: FORMAT_SELECTION_INSTRUCTIONS,
		prompt: buildFormatSelectionPrompt(snapshot.text),
		onProgress: options.onProgress,
		signal: options.signal,
	});
	const formattedText = preserveBoundaryNewlines(snapshot.text, normalizeFormattedSelection(response.text));

	if (!formattedText.trim()) {
		throw new Error("The model returned empty formatted text.");
	}

	const currentText = options.editor.getRange(snapshot.from, snapshot.to);
	if (currentText !== snapshot.text) {
		throw new SelectionChangedError();
	}

	options.editor.replaceRange(formattedText, snapshot.from, snapshot.to);
	options.editor.setSelection(snapshot.from, getEndPosition(snapshot.from, formattedText));

	return {
		formattedText,
		tokenUsage: response.usage,
	};
}

export function normalizeFormattedSelection(text: string): string {
	const trimmed = text.trim();
	const markdownFenceMatch = /^```(?:markdown|md)\s*\n([\s\S]*?)\n```$/iu.exec(trimmed);
	return markdownFenceMatch ? (markdownFenceMatch[1] ?? "").trim() : trimmed;
}

function getSelectionSnapshot(editor: Editor): SelectionSnapshot {
	return {
		from: editor.getCursor("from"),
		to: editor.getCursor("to"),
		text: editor.getSelection(),
	};
}

function buildFormatSelectionPrompt(selection: string): string {
	return [
		"Format this selected Obsidian Markdown. Replace only this selected text.",
		"",
		"<selected_markdown>",
		selection,
		"</selected_markdown>",
	].join("\n");
}

function preserveBoundaryNewlines(original: string, formatted: string): string {
	let result = formatted;
	if (original.startsWith("\n") && !result.startsWith("\n")) {
		result = `\n${result}`;
	}

	if (original.endsWith("\n") && !result.endsWith("\n")) {
		result = `${result}\n`;
	}

	return result;
}

function getEndPosition(start: EditorPosition, text: string): EditorPosition {
	const lines = text.split("\n");
	if (lines.length === 1) {
		return {
			line: start.line,
			ch: start.ch + (lines[0] ?? "").length,
		};
	}

	return {
		line: start.line + lines.length - 1,
		ch: (lines[lines.length - 1] ?? "").length,
	};
}
