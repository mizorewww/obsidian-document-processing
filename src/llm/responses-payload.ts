import { ApiUsagePayload } from "./token-usage";

export interface ResponsesOutputPayload {
	output_text?: string;
	output?: Array<{
		content?: Array<{
			text?: string;
			type?: string;
		}>;
		type?: string;
	}>;
	usage?: ApiUsagePayload;
}

export function extractResponsesOutputText(payload: ResponsesOutputPayload): string {
	if (typeof payload.output_text === "string") {
		return payload.output_text;
	}

	const outputParts: string[] = [];
	for (const item of payload.output ?? []) {
		for (const content of item.content ?? []) {
			if (typeof content.text === "string") {
				outputParts.push(content.text);
			}
		}
	}

	return outputParts.join("\n");
}
