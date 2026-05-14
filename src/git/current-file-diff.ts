import type { App, TFile } from "obsidian";

const MAX_DIFF_CHARS = 24000;

export interface CurrentFileGitDiff {
	diff: string;
	unavailableReason?: string;
	truncated: boolean;
}

interface ObsidianGitPluginLike {
	gitManager?: ObsidianGitManagerLike;
	gitReady?: boolean;
	isAllInitialized?: () => Promise<boolean>;
}

interface ObsidianGitManagerLike {
	getDiffString?: (repoPath: string, staged?: boolean, commit?: string) => Promise<string>;
	getRelativeRepoPath?: (vaultPath: string, fromVault?: boolean) => string;
}

export async function getCurrentFileWorkingTreeDiff(app: App, file: TFile): Promise<CurrentFileGitDiff> {
	const gitPlugin = getObsidianGitPlugin(app);
	if (!gitPlugin) {
		return unavailable("Obsidian Git plugin is not available.");
	}

	try {
		if (!gitPlugin.gitReady && gitPlugin.isAllInitialized && !await gitPlugin.isAllInitialized()) {
			return unavailable("Obsidian Git is not ready.");
		}

		const gitManager = gitPlugin.gitManager;
		if (!gitManager?.getDiffString) {
			return unavailable("Obsidian Git diff API is not available.");
		}

		const repoPath = gitManager.getRelativeRepoPath
			? gitManager.getRelativeRepoPath(file.path, true)
			: file.path;
		const [stagedDiff, unstagedDiff] = await Promise.all([
			readDiffPart(gitManager, repoPath, true),
			readDiffPart(gitManager, repoPath, false),
		]);
		const diff = formatUncommittedDiff(stagedDiff, unstagedDiff);
		return normalizeDiff(diff);
	} catch (error) {
		return unavailable(error instanceof Error ? error.message : String(error));
	}
}

function getObsidianGitPlugin(app: App): ObsidianGitPluginLike | null {
	const plugins = (app as unknown as {
		plugins?: {
			plugins?: Record<string, unknown>;
		};
	}).plugins?.plugins;
	const plugin = plugins?.["obsidian-git"];
	return isObsidianGitPluginLike(plugin) ? plugin : null;
}

function isObsidianGitPluginLike(value: unknown): value is ObsidianGitPluginLike {
	return Boolean(value) && typeof value === "object";
}

function normalizeDiff(value: unknown): CurrentFileGitDiff {
	const diff = typeof value === "string" ? value.trim() : "";
	if (!diff) {
		return {
			diff: "",
			truncated: false,
		};
	}

	if (diff.length <= MAX_DIFF_CHARS) {
		return {
			diff,
			truncated: false,
		};
	}

	return {
		diff: `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[Diff truncated to ${MAX_DIFF_CHARS} characters.]`,
		truncated: true,
	};
}

async function readDiffPart(gitManager: ObsidianGitManagerLike, repoPath: string, staged: boolean): Promise<string> {
	try {
		return (await gitManager.getDiffString?.(repoPath, staged)) ?? "";
	} catch (error) {
		console.error("Document Processing could not read Obsidian Git diff", error);
		return "";
	}
}

function formatUncommittedDiff(stagedDiff: string, unstagedDiff: string): string {
	const sections: string[] = [];
	if (stagedDiff.trim()) {
		sections.push([
			"Staged changes for this file (HEAD -> index):",
			stagedDiff.trim(),
		].join("\n"));
	}

	if (unstagedDiff.trim()) {
		sections.push([
			"Unstaged changes for this file (index -> working tree):",
			unstagedDiff.trim(),
		].join("\n"));
	}

	return sections.join("\n\n");
}

function unavailable(reason: string): CurrentFileGitDiff {
	return {
		diff: "",
		unavailableReason: reason,
		truncated: false,
	};
}
