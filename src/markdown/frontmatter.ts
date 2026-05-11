export interface MarkdownDocumentParts {
	frontmatterText: string | null;
	body: string;
}

export function splitFrontmatter(markdown: string): MarkdownDocumentParts {
	if (!markdown.startsWith("---")) {
		return {
			frontmatterText: null,
			body: markdown,
		};
	}

	const lines = markdown.split(/\r?\n/);
	if (lines[0] !== "---") {
		return {
			frontmatterText: null,
			body: markdown,
		};
	}

	const endIndex = lines.findIndex((line, index) => index > 0 && line === "---");
	if (endIndex < 0) {
		return {
			frontmatterText: null,
			body: markdown,
		};
	}

	return {
		frontmatterText: lines.slice(1, endIndex).join("\n"),
		body: lines.slice(endIndex + 1).join("\n").replace(/^\s*\n/u, ""),
	};
}

export function buildMarkdownWithFrontmatter(frontmatterYaml: string, body: string): string {
	const normalizedBody = body.trim();
	const normalizedYaml = frontmatterYaml.trim();
	return `---\n${normalizedYaml}\n---\n${normalizedBody}\n`;
}
