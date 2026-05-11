import { Platform, requestUrl, type RequestUrlResponse } from "obsidian";
import { CodexAuthData, DocumentProcessingSettings } from "../settings-data";

const CODEX_ISSUER = "https://auth.openai.com";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_DEVICE_BASE_URL = `${CODEX_ISSUER}/api/accounts`;
const TOKEN_REFRESH_GRACE_SECONDS = 5 * 60;

export const CODEX_DEVICE_VERIFICATION_URL = `${CODEX_ISSUER}/codex/device`;
export const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
export const CODEX_ORIGINATOR = "codex_cli_rs";
export const CODEX_VERSION = "0.130.0";

export interface CodexDeviceCode {
	verificationUrl: string;
	userCode: string;
	deviceAuthId: string;
	interval: number;
}

interface DeviceCodeResponse {
	device_auth_id?: string;
	user_code?: string;
	usercode?: string;
	interval?: string | number;
}

interface DeviceTokenResponse {
	authorization_code?: string;
	code_challenge?: string;
	code_verifier?: string;
}

interface TokenExchangeResponse {
	id_token?: string;
	access_token?: string;
	refresh_token?: string;
	error?: string;
	error_description?: string;
}

interface JwtClaims {
	email?: string;
	exp?: number;
	"https://api.openai.com/profile"?: {
		email?: string;
	};
	"https://api.openai.com/auth"?: {
		chatgpt_account_id?: string;
		chatgpt_plan_type?: string;
		chatgpt_account_is_fedramp?: boolean;
	};
}

export class CodexLoginAbortError extends Error {
	constructor() {
		super("Codex sign-in was canceled.");
		this.name = "CodexLoginAbortError";
	}
}

export class CodexCloudflareChallengeError extends Error {
	constructor(message = "OpenAI returned a Cloudflare verification page before issuing a Codex sign-in code.") {
		super(message);
		this.name = "CodexCloudflareChallengeError";
	}
}

export function isCodexLoginAbortError(error: unknown): boolean {
	return error instanceof CodexLoginAbortError;
}

export function isCodexCloudflareChallengeError(error: unknown): boolean {
	return error instanceof CodexCloudflareChallengeError;
}

export async function requestCodexDeviceCode(): Promise<CodexDeviceCode> {
	await warmCodexDeviceAuth();

	const response = await requestUrl({
		url: `${CODEX_DEVICE_BASE_URL}/deviceauth/usercode`,
		method: "POST",
		contentType: "application/json",
		headers: codexAuthHeaders(),
		body: JSON.stringify({
			client_id: CODEX_CLIENT_ID,
		}),
		throw: false,
	});

	if (response.status < 200 || response.status >= 300) {
		throw formatCodexAuthHttpError("Could not start Codex sign-in", response);
	}

	const payload = (response.json ?? {}) as DeviceCodeResponse;
	const userCode = payload.user_code ?? payload.usercode;
	const deviceAuthId = payload.device_auth_id;

	if (!userCode || !deviceAuthId) {
		throw new Error("Codex sign-in did not return a device code.");
	}

	return {
		verificationUrl: CODEX_DEVICE_VERIFICATION_URL,
		userCode,
		deviceAuthId,
		interval: parsePollingInterval(payload.interval),
	};
}

export async function completeCodexDeviceLogin(
	deviceCode: CodexDeviceCode,
	signal?: AbortSignal,
): Promise<CodexAuthData> {
	const codeResponse = await pollForAuthorizationCode(deviceCode, signal);
	throwIfLoginAborted(signal);

	const redirectUri = `${CODEX_ISSUER}/deviceauth/callback`;
	const tokenResponse = await exchangeAuthorizationCode(
		codeResponse.authorization_code,
		redirectUri,
		codeResponse.code_verifier,
	);

	if (!tokenResponse.id_token || !tokenResponse.access_token || !tokenResponse.refresh_token) {
		throw new Error("Codex sign-in did not return complete tokens.");
	}

	return buildCodexAuthData(tokenResponse.id_token, tokenResponse.access_token, tokenResponse.refresh_token);
}

export async function getValidCodexAuth(
	settings: DocumentProcessingSettings,
	saveSettings: () => Promise<void>,
): Promise<CodexAuthData> {
	const auth = settings.codexAuth;

	if (!auth) {
		throw new Error("Sign in with OpenAI through Codex before checking this provider.");
	}

	if (!shouldRefresh(auth)) {
		return auth;
	}

	const refreshed = await refreshCodexAuth(auth);
	settings.codexAuth = refreshed;
	await saveSettings();
	return refreshed;
}

export async function refreshCodexAuth(auth: CodexAuthData): Promise<CodexAuthData> {
	const response = await requestUrl({
		url: `${CODEX_ISSUER}/oauth/token`,
		method: "POST",
		contentType: "application/json",
		headers: codexAuthHeaders(),
		body: JSON.stringify({
			client_id: CODEX_CLIENT_ID,
			grant_type: "refresh_token",
			refresh_token: auth.refreshToken,
		}),
		throw: false,
	});

	const payload = (response.json ?? {}) as TokenExchangeResponse;

	if (response.status < 200 || response.status >= 300) {
		if (isCloudflareChallenge(response)) {
			throw formatCodexAuthHttpError("Could not refresh Codex sign-in", response);
		}

		throw new Error(formatTokenError("Could not refresh Codex sign-in", response.status, payload, response.text));
	}

	return buildCodexAuthData(
		payload.id_token ?? auth.idToken,
		payload.access_token ?? auth.accessToken,
		payload.refresh_token ?? auth.refreshToken,
	);
}

export function describeCodexAuth(auth: CodexAuthData | null): string {
	if (!auth) {
		return "Not signed in.";
	}

	const identity = auth.email || auth.accountId;
	const plan = auth.planType ? ` (${auth.planType})` : "";
	return `Signed in as ${identity}${plan}.`;
}

async function warmCodexDeviceAuth(): Promise<void> {
	try {
		await requestUrl({
			url: CODEX_DEVICE_VERIFICATION_URL,
			method: "GET",
			headers: codexAuthHeaders(),
			throw: false,
		});
	} catch {
		// The actual device-code request below reports the actionable failure.
	}
}

function codexAuthHeaders(): Record<string, string> {
	return {
		Accept: "application/json",
		Origin: CODEX_ISSUER,
		Referer: CODEX_DEVICE_VERIFICATION_URL,
		"User-Agent": getCodexUserAgent(),
		originator: CODEX_ORIGINATOR,
		version: CODEX_VERSION,
	};
}

export function getCodexUserAgent(): string {
	return `${CODEX_ORIGINATOR}/${CODEX_VERSION} (${getPlatformLabel()}) Obsidian`;
}

function formatCodexAuthHttpError(prefix: string, response: RequestUrlResponse): Error {
	if (isCloudflareChallenge(response)) {
		return new CodexCloudflareChallengeError(
			`${prefix}. OpenAI returned a Cloudflare verification page before issuing a Codex sign-in code.`,
		);
	}

	return new Error(`${prefix}. HTTP ${response.status}: ${response.text || "No response body."}`);
}

function isCloudflareChallenge(response: RequestUrlResponse): boolean {
	const mitigated = getHeader(response.headers, "cf-mitigated");
	return mitigated?.toLowerCase() === "challenge"
		|| (response.status === 403 && response.text.includes("Just a moment") && response.text.includes("Cloudflare"));
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
	const expected = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === expected) {
			return value;
		}
	}

	return undefined;
}

function getPlatformLabel(): string {
	if (Platform.isIosApp) {
		return "iOS";
	}

	if (Platform.isAndroidApp) {
		return "Android";
	}

	if (Platform.isWin) {
		return "Windows";
	}

	if (Platform.isMacOS) {
		return "macOS";
	}

	if (Platform.isLinux) {
		return "Linux";
	}

	return "unknown";
}

function parsePollingInterval(interval: string | number | undefined): number {
	const parsed = Number(interval);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

async function pollForAuthorizationCode(
	deviceCode: CodexDeviceCode,
	signal?: AbortSignal,
): Promise<{
	authorization_code: string;
	code_verifier: string;
}> {
	const startedAt = Date.now();
	const maxWaitMs = 15 * 60 * 1000;

	while (Date.now() - startedAt < maxWaitMs) {
		throwIfLoginAborted(signal);

		const response = await requestUrl({
			url: `${CODEX_DEVICE_BASE_URL}/deviceauth/token`,
			method: "POST",
			contentType: "application/json",
			headers: codexAuthHeaders(),
			body: JSON.stringify({
				device_auth_id: deviceCode.deviceAuthId,
				user_code: deviceCode.userCode,
			}),
			throw: false,
		});

		if (response.status >= 200 && response.status < 300) {
			const payload = (response.json ?? {}) as DeviceTokenResponse;
			if (payload.authorization_code && payload.code_verifier) {
				return {
					authorization_code: payload.authorization_code,
					code_verifier: payload.code_verifier,
				};
			}

			throw new Error("Codex sign-in returned an incomplete authorization response.");
		}

		throwIfLoginAborted(signal);

		if (isCloudflareChallenge(response)) {
			throw formatCodexAuthHttpError("Codex sign-in failed while waiting for authorization", response);
		}

		if (response.status !== 403 && response.status !== 404) {
			throw formatCodexAuthHttpError("Codex sign-in failed while waiting for authorization", response);
		}

		await delay(deviceCode.interval * 1000, signal);
	}

	throw new Error("Codex sign-in timed out after 15 minutes.");
}

async function exchangeAuthorizationCode(
	code: string,
	redirectUri: string,
	codeVerifier: string,
): Promise<TokenExchangeResponse> {
	const response = await requestUrl({
		url: `${CODEX_ISSUER}/oauth/token`,
		method: "POST",
		contentType: "application/x-www-form-urlencoded",
		headers: codexAuthHeaders(),
		body: toFormBody({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
			client_id: CODEX_CLIENT_ID,
			code_verifier: codeVerifier,
		}),
		throw: false,
	});
	const payload = (response.json ?? {}) as TokenExchangeResponse;

	if (response.status < 200 || response.status >= 300) {
		if (isCloudflareChallenge(response)) {
			throw formatCodexAuthHttpError("Codex token exchange failed", response);
		}

		throw new Error(formatTokenError("Codex token exchange failed", response.status, payload, response.text));
	}

	return payload;
}

function buildCodexAuthData(idToken: string, accessToken: string, refreshToken: string): CodexAuthData {
	const idClaims = parseJwtClaims(idToken);
	const accessClaims = parseJwtClaims(accessToken);
	const authClaims = idClaims["https://api.openai.com/auth"];
	const profileClaims = idClaims["https://api.openai.com/profile"];
	const accountId = authClaims?.chatgpt_account_id;

	if (!accountId) {
		throw new Error("Codex sign-in did not include a ChatGPT account ID.");
	}

	return {
		idToken,
		accessToken,
		refreshToken,
		accountId,
		email: idClaims.email ?? profileClaims?.email,
		planType: authClaims?.chatgpt_plan_type,
		expiresAt: accessClaims.exp,
		lastRefresh: new Date().toISOString(),
	};
}

function shouldRefresh(auth: CodexAuthData): boolean {
	if (!auth.expiresAt) {
		return false;
	}

	const nowSeconds = Math.floor(Date.now() / 1000);
	return auth.expiresAt - nowSeconds <= TOKEN_REFRESH_GRACE_SECONDS;
}

function parseJwtClaims(token: string): JwtClaims {
	const parts = token.split(".");
	if (parts.length < 2 || !parts[1]) {
		return {};
	}

	try {
		const json = decodeBase64Url(parts[1]);
		return JSON.parse(json) as JwtClaims;
	} catch {
		return {};
	}
}

function decodeBase64Url(value: string): string {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const paddingLength = (4 - normalized.length % 4) % 4;
	const padded = normalized + "=".repeat(paddingLength);
	return decodeURIComponent(Array.from(atob(padded), (char) => `%${toTwoDigitHex(char.charCodeAt(0))}`).join(""));
}

function toFormBody(values: Record<string, string>): string {
	return Object.keys(values)
		.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(values[key] ?? "")}`)
		.join("&");
}

function formatTokenError(prefix: string, status: number, payload: TokenExchangeResponse, text: string): string {
	const detail = payload.error_description || payload.error || text || "No response body.";
	return `${prefix}. HTTP ${status}: ${detail}`;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
	throwIfLoginAborted(signal);

	return new Promise((resolve, reject) => {
		let timeoutId: number | null = null;

		function cleanup() {
			if (timeoutId !== null) {
				window.clearTimeout(timeoutId);
			}
			signal?.removeEventListener("abort", abort);
		}

		function abort() {
			cleanup();
			reject(new CodexLoginAbortError());
		}

		timeoutId = window.setTimeout(() => {
			cleanup();
			resolve();
		}, ms);

		signal?.addEventListener("abort", abort, { once: true });
	});
}

function throwIfLoginAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new CodexLoginAbortError();
	}
}

function toTwoDigitHex(value: number): string {
	const hex = value.toString(16);
	return hex.length === 1 ? `0${hex}` : hex;
}
