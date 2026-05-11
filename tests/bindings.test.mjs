import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
	createQueueKey,
	fileMatchesTaskBinding,
	findAutoTaskBindingForFile,
	findTaskBindingForFile,
	getTaskPrompt,
	isLlmProcessed,
	isTaskProcessed,
	shouldAutoProcess,
	shouldAutoProcessTask,
} = await jiti.import("../src/tasks/bindings.ts");
const {
	AutoProcessor,
	AutoProcessDedupeTracker,
} = await jiti.import("../src/tasks/auto-processor.ts");
const {
	WEB_CLIPPER_BILINGUAL_CLEANUP_TASK,
} = await jiti.import("../src/tasks/web-clipper-bilingual-cleanup.ts");

const binding = {
	id: "clippings",
	autoProcess: true,
	folderPath: "Learning/Clippings",
	taskId: "web-clipper-bilingual-cleanup",
	recursive: true,
	promptOverride: "",
};

test("keeps legacy llm processed helpers for web cleanup", () => {
	assert.equal(isLlmProcessed({ llm: true }), true);
	assert.equal(shouldAutoProcess({ llm: true }), false);
	assert.equal(shouldAutoProcess({ llm: false }), true);
	assert.equal(shouldAutoProcess({ llm: "false" }), true);
	assert.equal(shouldAutoProcess({}), true);
	assert.equal(shouldAutoProcess({ llm: null }), true);
});

test("uses each task's own processed marker", () => {
	const webTask = { processedFrontmatterKey: "llm" };
	const ankiTask = { processedFrontmatterKey: "anki" };

	assert.equal(isTaskProcessed({ llm: true }, webTask), true);
	assert.equal(isTaskProcessed({ llm: true }, ankiTask), false);
	assert.equal(shouldAutoProcessTask({ anki: true }, ankiTask), false);
	assert.equal(shouldAutoProcessTask({ anki: "false" }, ankiTask), true);
	assert.equal(shouldAutoProcessTask({}, ankiTask), true);
});

test("matches folder bindings for markdown files", () => {
	assert.equal(fileMatchesTaskBinding("Learning/Clippings/Article.md", binding), true);
	assert.equal(fileMatchesTaskBinding("Learning/Clippings/Nested/Article.md", binding), true);
	assert.equal(fileMatchesTaskBinding("Learning/Clippings/Article.pdf", binding), false);
	assert.equal(fileMatchesTaskBinding("Learning/Other/Article.md", binding), false);

	const shallowBinding = { ...binding, recursive: false };
	assert.equal(fileMatchesTaskBinding("Learning/Clippings/Article.md", shallowBinding), true);
	assert.equal(fileMatchesTaskBinding("Learning/Clippings/Nested/Article.md", shallowBinding), false);
});

test("chooses the most specific binding for manual tasks", () => {
	const specific = { ...binding, id: "specific", folderPath: "Learning/Clippings/Nested" };
	const manualOnly = { ...specific, id: "manual-only", autoProcess: false, promptOverride: "manual" };

	assert.equal(findTaskBindingForFile("Learning/Clippings/Nested/Article.md", [binding, specific])?.id, "specific");
	assert.equal(findTaskBindingForFile("Learning/Clippings/Nested/Article.md", [binding, manualOnly])?.id, "manual-only");
	assert.equal(findAutoTaskBindingForFile("Learning/Clippings/Nested/Article.md", [binding, manualOnly])?.id, "clippings");
});

test("uses binding prompt override before task default", () => {
	assert.equal(getTaskPrompt(WEB_CLIPPER_BILINGUAL_CLEANUP_TASK, binding), WEB_CLIPPER_BILINGUAL_CLEANUP_TASK.defaultPrompt);
	assert.equal(getTaskPrompt(WEB_CLIPPER_BILINGUAL_CLEANUP_TASK, {
		...binding,
		promptOverride: "Custom prompt",
	}), "Custom prompt");
});

test("deduplicates queued and failed auto processing keys", () => {
	const tracker = new AutoProcessDedupeTracker();
	const key = createQueueKey("Learning/Clippings/Article.md", "hash-a", "web-clipper-bilingual-cleanup");

	assert.equal(tracker.canQueue(key), true);
	tracker.markQueued(key);
	assert.equal(tracker.canQueue(key), false);
	tracker.markDequeued(key);
	assert.equal(tracker.canQueue(key), true);
	tracker.markFailed(key);
	assert.equal(tracker.canQueue(key), false);
});

test("queue keys are separate per task for the same file hash", () => {
	const webKey = createQueueKey("Learning/Clippings/Article.md", "hash-a", "web-clipper-bilingual-cleanup");
	const ankiKey = createQueueKey("Learning/Clippings/Article.md", "hash-a", "anki-card-generation");

	assert.notEqual(webKey, ankiKey);
});

test("auto scanning can enqueue one candidate per matching task", async () => {
	const ankiBinding = {
		...binding,
		id: "anki",
		taskId: "anki-card-generation",
	};
	const markdown = "---\nllm: false\nanki: false\n---\n# Note\n";
	const processor = new AutoProcessor({
		app: {
			vault: {
				cachedRead: async () => markdown,
			},
		},
		getSettings: () => ({
			taskBindings: [binding, ankiBinding],
		}),
		getTaskDefinition: (taskId) => ({
			processedFrontmatterKey: taskId === "anki-card-generation" ? "anki" : "llm",
		}),
		runTask: async () => {
			throw new Error("not used");
		},
		onQueueChange: () => undefined,
		onAutoFailure: () => undefined,
	});

	const candidates = await processor.getAutoCandidates({
		path: "Learning/Clippings/New.md",
		extension: "md",
	});

	assert.deepEqual(candidates.map((candidate) => candidate.binding.id), ["clippings", "anki"]);
});

test("startup scanning candidates are unprocessed markdown files in bound folders", () => {
	const files = [
		{ path: "Learning/Clippings/New.md", frontmatter: { llm: "false" } },
		{ path: "Learning/Clippings/Done.md", frontmatter: { llm: true } },
		{ path: "Learning/Other/Skip.md", frontmatter: {} },
		{ path: "Learning/Clippings/Image.png", frontmatter: {} },
	];

	const candidates = files
		.filter((file) => findTaskBindingForFile(file.path, [binding]) && shouldAutoProcess(file.frontmatter))
		.map((file) => file.path);

	assert.deepEqual(candidates, ["Learning/Clippings/New.md"]);
});
