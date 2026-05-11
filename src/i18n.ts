export type LanguageSetting = "auto" | "zh-CN" | "en";
export type ResolvedLanguage = "zh-CN" | "en";

type TranslationValues = Record<string, string | number>;

const ZH = {
	"command.checkSelectedModel": "检查当前模型",

	"language.auto": "跟随系统",
	"language.zhCN": "简体中文",
	"language.en": "English",

	"provider.openaiApi": "OpenAI API key",
	"provider.codexLogin": "OpenAI 账号登录",

	"settings.title": "文档处理",
	"settings.subtitle": "选择模型服务，并确认当前模型可以正常使用。",

	"section.general": "基本设置",
	"setting.language.name": "语言",
	"setting.language.desc": "选择插件界面使用的语言。",
	"setting.provider.name": "模型服务",
	"setting.provider.desc": "选择使用 API key，还是使用 OpenAI 账号登录。",

	"section.account": "账号",
	"account.status": "状态",
	"account.notConfigured": "未配置",
	"account.notSignedIn": "未登录",
	"account.signedInAs": "已登录：{identity}",
	"account.plan": "计划：{plan}",
	"account.planUnknown": "计划未知",
	"account.lastChecked": "上次检查：{result}",
	"api.key.name": "API key",
	"api.key.desc": "用于直接调用 OpenAI API。",
	"api.key.placeholder": "输入 API key",
	"api.keySaved": "已保存：{key}",
	"api.keyMissing": "添加 API key 后即可检查模型。",
	"codex.signIn.name": "OpenAI 账号",
	"codex.signIn.desc": "登录后可以使用账号可用的模型。",
	"codex.signIn.button": "登录",
	"codex.signInAgain.button": "重新登录",
	"codex.signOut.button": "退出",
	"codex.requestingCode": "正在获取登录代码...",
	"codex.codeCopied.notice": "登录代码已复制到剪贴板。",
	"codex.codeCopyFailed.notice": "请在设置页复制登录代码。",
	"codex.signInDone.notice": "登录完成。",
	"codex.signedOut.notice": "已退出登录。",
	"codex.restart.button": "重新开始",
	"codex.device.open": "打开",
	"codex.device.page": "登录页面",
	"codex.device.enterCode": "并输入这个代码：",
	"codex.device.copied": "代码已自动复制到剪贴板。完成浏览器里的授权后，这里会自动更新。",
	"codex.device.copyFailed": "自动复制失败。请手动复制代码，再完成浏览器里的授权。",
	"codex.device.restartHint": "选择重新开始可以获取新代码。",
	"codex.cloudflare": "OpenAI 需要先完成浏览器验证。完成后再选择登录。",
	"codex.canceled": "登录已取消。选择登录可以重新开始。",
	"codex.failed": "登录失败。",

	"section.model": "模型",
	"model.name": "模型",
	"model.desc": "选择一个预设模型。",
	"model.custom.name": "自定义模型",
	"model.custom.desc": "如果列表里没有要用的模型，可以在这里粘贴模型 ID。",
	"model.custom.placeholder": "模型 ID",
	"model.customOption": "自定义：{model}",
	"model.currentPreset": "当前：{description}",
	"model.customDescription": "自定义模型",

	"codex.intelligence.name": "智能水平",
	"codex.intelligence.desc": "越高越适合复杂文档；越低响应越快。",
	"codex.speed.name": "响应速度",
	"codex.speed.desc": "标准适合大多数情况；优先更快；弹性可能更慢。",
	"reasoning.minimal": "极快",
	"reasoning.minimal.desc": "适合简单整理和分类。",
	"reasoning.low": "低",
	"reasoning.low.desc": "偏速度。",
	"reasoning.medium": "中",
	"reasoning.medium.desc": "均衡默认值。",
	"reasoning.high": "高",
	"reasoning.high.desc": "适合复杂文档。",
	"reasoning.xhigh": "极高",
	"reasoning.xhigh.desc": "最强推理，可能更慢。",
	"speed.default": "标准",
	"speed.default.desc": "使用默认速度。",
	"speed.priority": "优先",
	"speed.priority.desc": "尽量更快。",
	"speed.flex": "弹性",
	"speed.flex.desc": "可能更慢。",

	"section.check": "检查",
	"check.status.name": "上次结果",
	"check.status.empty": "还没有检查。",
	"check.button.name": "检查当前模型",
	"check.button.desc": "发送一条很短的测试消息，确认账号和模型可用。",
	"check.button": "检查",
	"check.running": "正在检查...",
	"check.failed": "检查失败。",
	"check.ok": "可用",
	"check.bad": "失败",
	"check.detail": "{status}：{model}{latency}，{date}",
	"check.latency": "，{latency} ms",
	"check.error.missingApiKey": "请先填写 OpenAI API key。",
	"check.error.missingOpenAiModel": "请先选择 OpenAI 模型。",
	"check.error.missingCodexModel": "请先选择模型。",
	"check.error.notSignedIn": "请先登录 OpenAI 账号。",
	"check.error.signInUnavailable": "登录状态不可用，请重新登录。",
	"check.error.openAiDefault": "OpenAI API 返回了错误。",
	"check.error.openAiHttp": "OpenAI API 检查失败（HTTP {status}{code}）：{message}",
	"check.error.modelHttp": "当前模型检查失败（HTTP {status}）：{message}",
	"check.error.unexpectedOutput": "{provider} 已响应，但测试结果不符合预期：{output}",
	"check.emptyOutput": "空响应",
	"check.success": "{provider} 模型 {model} 可用（{latency} ms）。",
} as const;

type TranslationKey = keyof typeof ZH;

const EN: Record<TranslationKey, string> = {
	"command.checkSelectedModel": "Check selected model",

	"language.auto": "Follow system",
	"language.zhCN": "Simplified Chinese",
	"language.en": "English",

	"provider.openaiApi": "OpenAI API key",
	"provider.codexLogin": "OpenAI account",

	"settings.title": "Document processing",
	"settings.subtitle": "Choose a model service and check that the selected model works.",

	"section.general": "General",
	"setting.language.name": "Language",
	"setting.language.desc": "Choose the language used by this plugin.",
	"setting.provider.name": "Model service",
	"setting.provider.desc": "Use an API key or sign in with your OpenAI account.",

	"section.account": "Account",
	"account.status": "Status",
	"account.notConfigured": "Not configured",
	"account.notSignedIn": "Not signed in",
	"account.signedInAs": "Signed in as {identity}",
	"account.plan": "Plan: {plan}",
	"account.planUnknown": "Plan unknown",
	"account.lastChecked": "Last check: {result}",
	"api.key.name": "API key",
	"api.key.desc": "Used to call the OpenAI API directly.",
	"api.key.placeholder": "Enter API key",
	"api.keySaved": "Saved: {key}",
	"api.keyMissing": "Add an API key before checking a model.",
	"codex.signIn.name": "OpenAI account",
	"codex.signIn.desc": "Sign in to use the models available to your account.",
	"codex.signIn.button": "Sign in",
	"codex.signInAgain.button": "Sign in again",
	"codex.signOut.button": "Sign out",
	"codex.requestingCode": "Getting sign-in code...",
	"codex.codeCopied.notice": "Sign-in code copied to clipboard.",
	"codex.codeCopyFailed.notice": "Copy the sign-in code from settings.",
	"codex.signInDone.notice": "Signed in.",
	"codex.signedOut.notice": "Signed out.",
	"codex.restart.button": "Restart",
	"codex.device.open": "Open",
	"codex.device.page": "the sign-in page",
	"codex.device.enterCode": "and enter this code:",
	"codex.device.copied": "The code was copied to your clipboard. Finish authorization in the browser and this page will update automatically.",
	"codex.device.copyFailed": "Automatic copy failed. Copy the code manually, then finish authorization in the browser.",
	"codex.device.restartHint": "Select restart to get a new code.",
	"codex.cloudflare": "OpenAI needs a browser verification first. Finish it, then select sign in again.",
	"codex.canceled": "Sign-in canceled. Select sign in to start again.",
	"codex.failed": "Sign-in failed.",

	"section.model": "Model",
	"model.name": "Model",
	"model.desc": "Choose a preset model.",
	"model.custom.name": "Custom model",
	"model.custom.desc": "Paste a model ID here if it is not in the list.",
	"model.custom.placeholder": "Model ID",
	"model.customOption": "Custom: {model}",
	"model.currentPreset": "Current: {description}",
	"model.customDescription": "Custom model",

	"codex.intelligence.name": "Intelligence",
	"codex.intelligence.desc": "Higher is better for complex documents; lower responds faster.",
	"codex.speed.name": "Speed",
	"codex.speed.desc": "Standard fits most cases; priority is faster; flex can be slower.",
	"reasoning.minimal": "Very fast",
	"reasoning.minimal.desc": "Good for simple cleanup and classification.",
	"reasoning.low": "Low",
	"reasoning.low.desc": "Favors speed.",
	"reasoning.medium": "Medium",
	"reasoning.medium.desc": "Balanced default.",
	"reasoning.high": "High",
	"reasoning.high.desc": "Good for complex documents.",
	"reasoning.xhigh": "Very high",
	"reasoning.xhigh.desc": "Strongest reasoning, potentially slower.",
	"speed.default": "Standard",
	"speed.default.desc": "Use the default speed.",
	"speed.priority": "Priority",
	"speed.priority.desc": "Prefer faster handling.",
	"speed.flex": "Flex",
	"speed.flex.desc": "Can be slower.",

	"section.check": "Check",
	"check.status.name": "Last result",
	"check.status.empty": "Not checked yet.",
	"check.button.name": "Check selected model",
	"check.button.desc": "Sends a tiny test message to confirm the account and model work.",
	"check.button": "Check",
	"check.running": "Checking...",
	"check.failed": "Check failed.",
	"check.ok": "Working",
	"check.bad": "Failed",
	"check.detail": "{status}: {model}{latency}, {date}",
	"check.latency": ", {latency} ms",
	"check.error.missingApiKey": "Add an OpenAI API key first.",
	"check.error.missingOpenAiModel": "Choose an OpenAI model first.",
	"check.error.missingCodexModel": "Choose a model first.",
	"check.error.notSignedIn": "Sign in with your OpenAI account first.",
	"check.error.signInUnavailable": "The sign-in session is not available. Sign in again.",
	"check.error.openAiDefault": "The OpenAI API returned an error.",
	"check.error.openAiHttp": "OpenAI API check failed (HTTP {status}{code}): {message}",
	"check.error.modelHttp": "Selected model check failed (HTTP {status}): {message}",
	"check.error.unexpectedOutput": "{provider} responded, but the test output was unexpected: {output}",
	"check.emptyOutput": "empty response",
	"check.success": "{provider} model {model} is working ({latency} ms).",
};

export function translate(language: LanguageSetting, key: TranslationKey, values: TranslationValues = {}): string {
	const dictionary = language === "en" ? EN : language === "zh-CN" ? ZH : getAutoDictionary();
	return interpolate(dictionary[key], values);
}

export function resolveLanguage(language: LanguageSetting): ResolvedLanguage {
	if (language === "zh-CN" || language === "en") {
		return language;
	}

	return getBrowserLanguage();
}

export function isLanguageSetting(value: unknown): value is LanguageSetting {
	return value === "auto" || value === "zh-CN" || value === "en";
}

function getAutoDictionary(): Record<TranslationKey, string> {
	return getBrowserLanguage() === "zh-CN" ? ZH : EN;
}

function getBrowserLanguage(): ResolvedLanguage {
	return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function interpolate(template: string, values: TranslationValues): string {
	return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
		const value = values[name];
		return value === undefined ? match : String(value);
	});
}
