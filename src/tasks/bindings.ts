import { DEFAULT_PROCESSING_TASK_ID, isProcessingTaskId, ProcessingTaskId } from "./task-ids";
import { TaskDefinition } from "./types";

export interface TaskBinding {
	id: string;
	autoProcess: boolean;
	folderPath: string;
	taskId: ProcessingTaskId;
	recursive: boolean;
	promptOverride: string;
}

export const DEFAULT_TASK_BINDING_ID = "learning-clippings-web-clipper";
export const DEFAULT_TASK_BINDING_FOLDER = "Learning/Clippings";

export const DEFAULT_TASK_BINDINGS: TaskBinding[] = [
	{
		id: DEFAULT_TASK_BINDING_ID,
		autoProcess: false,
		folderPath: DEFAULT_TASK_BINDING_FOLDER,
		taskId: DEFAULT_PROCESSING_TASK_ID,
		recursive: true,
		promptOverride: "",
	},
];

export function normalizeTaskBindings(value: unknown): TaskBinding[] {
	if (!Array.isArray(value)) {
		return DEFAULT_TASK_BINDINGS.map((binding) => ({ ...binding }));
	}

	const bindings = value
		.map((item, index) => normalizeTaskBinding(item, index))
		.filter((binding): binding is TaskBinding => binding !== null);

	return bindings.length > 0 ? bindings : DEFAULT_TASK_BINDINGS.map((binding) => ({ ...binding }));
}

export function normalizeTaskBinding(value: unknown, index = 0): TaskBinding | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const raw = value as Record<string, unknown>;
	const taskId = isProcessingTaskId(raw.taskId) ? raw.taskId : DEFAULT_PROCESSING_TASK_ID;
	const id = typeof raw.id === "string" && raw.id.trim()
		? raw.id.trim()
		: createTaskBindingId(index);

	return {
		id,
		autoProcess: getAutoProcessValue(raw),
		folderPath: normalizeVaultFolderPath(typeof raw.folderPath === "string" ? raw.folderPath : DEFAULT_TASK_BINDING_FOLDER),
		taskId,
		recursive: raw.recursive !== false,
		promptOverride: typeof raw.promptOverride === "string" ? raw.promptOverride : "",
	};
}

export function createTaskBindingId(index = 0): string {
	const suffix = Math.random().toString(36).slice(2, 8);
	return `task-binding-${Date.now().toString(36)}-${index}-${suffix}`;
}

export function normalizeVaultFolderPath(path: string): string {
	return path
		.trim()
		.replace(/\\/gu, "/")
		.replace(/\/+/gu, "/")
		.replace(/^\/+|\/+$/gu, "");
}

export function findTaskBindingForFile(filePath: string, bindings: TaskBinding[]): TaskBinding | null {
	const normalizedFilePath = normalizeVaultFilePath(filePath);
	const matches = bindings
		.filter((binding) => fileMatchesTaskBinding(normalizedFilePath, binding))
		.sort((left, right) => normalizeVaultFolderPath(right.folderPath).length - normalizeVaultFolderPath(left.folderPath).length);

	return matches[0] ?? null;
}

export function findAutoTaskBindingForFile(filePath: string, bindings: TaskBinding[]): TaskBinding | null {
	const binding = findTaskBindingForFile(filePath, bindings.filter((item) => item.autoProcess));
	return binding;
}

export function fileMatchesTaskBinding(filePath: string, binding: TaskBinding): boolean {
	if (!isMarkdownPath(filePath)) {
		return false;
	}

	const folderPath = normalizeVaultFolderPath(binding.folderPath);
	const normalizedFilePath = normalizeVaultFilePath(filePath);

	if (!folderPath) {
		return true;
	}

	if (binding.recursive) {
		return normalizedFilePath.startsWith(`${folderPath}/`);
	}

	const parentPath = normalizedFilePath.includes("/")
		? normalizedFilePath.slice(0, normalizedFilePath.lastIndexOf("/"))
		: "";
	return parentPath === folderPath;
}

export function isLlmProcessed(frontmatter: Record<string, unknown>): boolean {
	return frontmatter.llm === true;
}

export function shouldAutoProcess(frontmatter: Record<string, unknown>): boolean {
	return !isLlmProcessed(frontmatter);
}

export function isTaskProcessed(frontmatter: Record<string, unknown>, task: Pick<TaskDefinition, "processedFrontmatterKey">): boolean {
	return frontmatter[task.processedFrontmatterKey] === true;
}

export function shouldAutoProcessTask(frontmatter: Record<string, unknown>, task: Pick<TaskDefinition, "processedFrontmatterKey">): boolean {
	return !isTaskProcessed(frontmatter, task);
}

export function getTaskPrompt(task: TaskDefinition, binding: TaskBinding | null): string {
	const override = binding?.promptOverride.trim();
	return override || task.defaultPrompt;
}

export function createQueueSlotKey(filePath: string, taskId: ProcessingTaskId = DEFAULT_PROCESSING_TASK_ID): string {
	return `${normalizeVaultFilePath(filePath)}:${taskId}`;
}

function normalizeVaultFilePath(path: string): string {
	return path
		.trim()
		.replace(/\\/gu, "/")
		.replace(/\/+/gu, "/")
		.replace(/^\/+/gu, "");
}

function isMarkdownPath(filePath: string): boolean {
	return /\.md$/iu.test(filePath);
}

function getAutoProcessValue(raw: Record<string, unknown>): boolean {
	if (typeof raw.autoProcess === "boolean") {
		return raw.autoProcess;
	}

	if (typeof raw.enabled === "boolean") {
		return raw.enabled;
	}

	return false;
}
