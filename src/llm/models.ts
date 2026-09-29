export interface ModelOption {
	id: string;
	name: string;
	description: string;
}

export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type CodexServiceTier = "default" | "priority" | "flex";

export const CODEX_REASONING_EFFORTS: ModelOption[] = [
	{
		id: "minimal",
		name: "极快",
		description: "最快响应，适合简单清理和分类。",
	},
	{
		id: "low",
		name: "低",
		description: "偏速度，适合轻量任务。",
	},
	{
		id: "medium",
		name: "中",
		description: "文档处理的均衡默认值。",
	},
	{
		id: "high",
		name: "高",
		description: "更完整的推理，适合复杂文档。",
	},
	{
		id: "xhigh",
		name: "极高",
		description: "最高推理强度，需要所选模型支持。",
	},
];

export const CODEX_SERVICE_TIERS: ModelOption[] = [
	{
		id: "default",
		name: "标准",
		description: "使用账号或项目默认速度档位。",
	},
	{
		id: "priority",
		name: "优先",
		description: "支持时使用更快处理。",
	},
	{
		id: "flex",
		name: "弹性",
		description: "支持时使用较低优先级处理。",
	},
];

export const OPENAI_API_MODELS: ModelOption[] = [
	{
		id: "gpt-5.5",
		name: "GPT-5.5",
		description: "Best default for complex document reasoning.",
	},
	{
		id: "gpt-5.4",
		name: "GPT-5.4",
		description: "Strong general-purpose reasoning at a lower cost.",
	},
	{
		id: "gpt-5.4-mini",
		name: "GPT-5.4 mini",
		description: "Balanced default for latency and cost.",
	},
	{
		id: "gpt-5.4-nano",
		name: "GPT-5.4 nano",
		description: "Fast, low-cost option for simple processing.",
	},
	{
		id: "gpt-5-mini",
		name: "GPT-5 mini",
		description: "Cost-sensitive near-frontier model.",
	},
	{
		id: "gpt-5-nano",
		name: "GPT-5 nano",
		description: "Fastest GPT-5-class option.",
	},
	{
		id: "gpt-4.1",
		name: "GPT-4.1",
		description: "Useful compatibility option for older workflows.",
	},
];

export const CODEX_MODELS: ModelOption[] = [
	{
		id: "gpt-5.5",
		name: "GPT-5.5",
		description: "Highest-capability Codex-backed option.",
	},
	{
		id: "gpt-5.4",
		name: "GPT-5.4",
		description: "Strong general-purpose Codex model.",
	},
	{
		id: "gpt-5.4-mini",
		name: "GPT-5.4 mini",
		description: "Balanced default for checks and short tasks.",
	},
	{
		id: "gpt-5.4-nano",
		name: "GPT-5.4 nano",
		description: "Fast, low-cost option when available.",
	},
	{
		id: "codex-mini-latest",
		name: "Codex mini latest",
		description: "Codex-optimized model alias when supported.",
	},
	{
		id: "gpt-5.3-codex",
		name: "GPT-5.3 Codex",
		description: "Coding-optimized Codex model when available.",
	},
	{
		id: "gpt-5.3-codex-spark",
		name: "GPT-5.3 Codex Spark",
		description: "Fast Codex model when available.",
	},
];

export const OLLAMA_CLOUD_MODELS: ModelOption[] = [
	{
		id: "gpt-oss:120b",
		name: "GPT-OSS 120B",
		description: "Strong general-purpose cloud model.",
	},
	{
		id: "gpt-oss:20b",
		name: "GPT-OSS 20B",
		description: "Faster, lower-cost cloud model.",
	},
	{
		id: "deepseek-v4-flash:0731",
		name: "DeepSeek V4 Flash",
		description: "Fast cloud model for everyday tasks.",
	},
	{
		id: "deepseek-v4-pro:0813",
		name: "DeepSeek V4 Pro",
		description: "Strong reasoning cloud model.",
	},
	{
		id: "qwen3.5:397b",
		name: "Qwen 3.5 397B",
		description: "Large multilingual cloud model.",
	},
	{
		id: "kimi-k2.6",
		name: "Kimi K2.6",
		description: "General-purpose cloud model.",
	},
	{
		id: "glm-5.2",
		name: "GLM 5.2",
		description: "Balanced cloud model.",
	},
	{
		id: "minimax-m3",
		name: "MiniMax M3",
		description: "Fast cloud model.",
	},
	{
		id: "gemma4:31b",
		name: "Gemma 4 31B",
		description: "Efficient cloud model.",
	},
	{
		id: "mistral-large-3:675b",
		name: "Mistral Large 3 675B",
		description: "Large European cloud model.",
	},
	{
		id: "nemotron-3-ultra",
		name: "Nemotron 3 Ultra",
		description: "High-capability cloud model.",
	},
];

export function getModelOption(options: ModelOption[], modelId: string): ModelOption | undefined {
	return options.find((option) => option.id === modelId);
}
