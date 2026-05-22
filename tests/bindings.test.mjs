import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
	createQueueSlotKey,
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
	ProcessingCanceledError,
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

test("deduplicates only currently queued auto processing keys", () => {
	const tracker = new AutoProcessDedupeTracker();
	const key = "auto:Learning/Clippings/Article.md:web-clipper-bilingual-cleanup:test";

	assert.equal(tracker.canQueue(key), true);
	tracker.markQueued(key);
	assert.equal(tracker.canQueue(key), false);
	tracker.markDequeued(key);
	assert.equal(tracker.canQueue(key), true);
});

test("auto queue slots are separate per task for the same file", () => {
	const webKey = createQueueSlotKey("Learning/Clippings/Article.md", "web-clipper-bilingual-cleanup");
	const formattingKey = createQueueSlotKey("Learning/Clippings/Article.md", "note-formatting");
	const ankiKey = createQueueSlotKey("Learning/Clippings/Article.md", "anki-card-generation");

	assert.notEqual(webKey, ankiKey);
	assert.notEqual(webKey, formattingKey);
	assert.notEqual(formattingKey, ankiKey);
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

test("active auto tasks stay deduplicated until they finish", async () => {
	const file = {
		path: "Learning/Clippings/New.md",
		extension: "md",
	};
	const markdown = "---\nllm: false\n---\n# Note\n";
	const processor = new AutoProcessor({
		app: {
			vault: {
				getMarkdownFiles: () => [file],
				cachedRead: async () => markdown,
			},
		},
		getSettings: () => ({
			taskBindings: [binding],
		}),
		getTaskDefinition: () => ({
			name: "Web clipping cleanup",
			processedFrontmatterKey: "llm",
		}),
		runTask: async (_file, _binding, _source, _pendingCount, _taskId, signal) => {
			await new Promise((_, reject) => {
				signal.addEventListener("abort", () => reject(new ProcessingCanceledError()), { once: true });
			});
		},
		onQueueChange: () => undefined,
		onAutoFailure: () => undefined,
	});

	await processor.scanAll();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(processor.getQueueSnapshot().totalCount, 1);

	await processor.handleCreate(file);
	await new Promise((resolve) => setTimeout(resolve, 0));
	const snapshot = processor.getQueueSnapshot();
	assert.equal(snapshot.totalCount, 1);
	assert.equal(snapshot.active?.filePath, "Learning/Clippings/New.md");
	assert.equal(typeof snapshot.active?.queuedAt, "number");
	assert.equal(typeof snapshot.active?.startedAt, "number");
	assert.equal(snapshot.pending.length, 0);

	processor.cancelAll();
	await new Promise((resolve) => setTimeout(resolve, 0));
});

test("auto file changes during an active task coalesce into one follow-up task", async () => {
	const file = {
		path: "Learning/Clippings/New.md",
		extension: "md",
	};
	let markdown = "---\nllm: false\n---\n# Note\n\nFirst version.\n";
	const processor = new AutoProcessor({
		app: {
			vault: {
				getMarkdownFiles: () => [file],
				cachedRead: async () => markdown,
			},
		},
		getSettings: () => ({
			taskBindings: [binding],
		}),
		getTaskDefinition: () => ({
			name: "Web clipping cleanup",
			processedFrontmatterKey: "llm",
		}),
		runTask: async (_file, _binding, _source, _pendingCount, _taskId, signal) => {
			await new Promise((_, reject) => {
				signal.addEventListener("abort", () => reject(new ProcessingCanceledError()), { once: true });
			});
		},
		onQueueChange: () => undefined,
		onAutoFailure: () => undefined,
	});

	await processor.scanAll();
	await new Promise((resolve) => setTimeout(resolve, 0));

	markdown = "---\nllm: false\n---\n# Note\n\nSecond version.\n";
	await processor.handleRename(file);
	await new Promise((resolve) => setTimeout(resolve, 0));
	const firstEditSnapshot = processor.getQueueSnapshot();
	assert.equal(firstEditSnapshot.totalCount, 2);
	assert.equal(firstEditSnapshot.pending.length, 1);
	assert.equal(typeof firstEditSnapshot.active?.startedAt, "number");
	assert.equal(typeof firstEditSnapshot.pending[0]?.queuedAt, "number");
	assert.equal(firstEditSnapshot.pending[0]?.startedAt, null);
	const firstPendingId = firstEditSnapshot.pending[0]?.id;

	markdown = "---\nllm: false\n---\n# Note\n\nThird version.\n";
	await processor.handleRename(file);
	await new Promise((resolve) => setTimeout(resolve, 0));
	const secondEditSnapshot = processor.getQueueSnapshot();
	assert.equal(secondEditSnapshot.totalCount, 2);
	assert.equal(secondEditSnapshot.pending.length, 1);
	assert.equal(secondEditSnapshot.pending[0]?.id, firstPendingId);

	processor.cancelAll();
	await new Promise((resolve) => setTimeout(resolve, 0));
});

test("queue cancellation rejects pending work", async () => {
	const processor = new AutoProcessor({
		app: {
			vault: {
				cachedRead: async () => "# Note\n",
			},
		},
		getSettings: () => ({
			taskBindings: [],
		}),
		getTaskDefinition: () => ({
			processedFrontmatterKey: "llm",
		}),
		runTask: async (_file, _binding, _source, _pendingCount, _taskId, signal) => {
			await new Promise((_, reject) => {
				signal.addEventListener("abort", () => reject(new ProcessingCanceledError()), { once: true });
			});
		},
		onQueueChange: () => undefined,
		onAutoFailure: () => undefined,
	});
	const file = {
		path: "Learning/Clippings/New.md",
		extension: "md",
	};
	const first = processor.enqueueManual(file, binding);
	const second = processor.enqueueManual(file, binding);

	assert.equal(processor.cancelAll(), 2);
	await assert.rejects(first, ProcessingCanceledError);
	await assert.rejects(second, ProcessingCanceledError);
});

test("queue snapshot exposes tasks and cancelItem cancels a specific task", async () => {
	const processor = new AutoProcessor({
		app: {
			vault: {
				cachedRead: async () => "# Note\n",
			},
		},
		getSettings: () => ({
			taskBindings: [],
		}),
		getTaskDefinition: (taskId) => ({
			name: taskId === "anki-card-generation" ? "Anki card generation" : "Web clipping cleanup",
			processedFrontmatterKey: "llm",
		}),
		runTask: async (_file, _binding, _source, _pendingCount, _taskId, signal) => {
			await new Promise((_, reject) => {
				signal.addEventListener("abort", () => reject(new ProcessingCanceledError()), { once: true });
			});
		},
		onQueueChange: () => undefined,
		onAutoFailure: () => undefined,
	});
	const file = {
		path: "Learning/Clippings/New.md",
		extension: "md",
	};
	const first = processor.enqueueManual(file, binding, "anki-card-generation");
	const second = processor.enqueueManual(file, binding, "web-clipper-bilingual-cleanup");
	await new Promise((resolve) => setTimeout(resolve, 0));

	const snapshot = processor.getQueueSnapshot();
	assert.equal(snapshot.active?.taskId, "anki-card-generation");
	assert.equal(snapshot.active?.taskName, "Anki card generation");
	assert.equal(snapshot.pending[0]?.taskId, "web-clipper-bilingual-cleanup");
	assert.equal(processor.cancelItem(snapshot.pending[0]?.id ?? ""), true);
	await assert.rejects(second, ProcessingCanceledError);
	assert.equal(processor.cancelItem(snapshot.active?.id ?? ""), true);
	await assert.rejects(first, ProcessingCanceledError);
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
