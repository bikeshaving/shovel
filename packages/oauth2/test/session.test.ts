import {describe, test, expect, beforeEach, afterEach} from "bun:test";
import {Router} from "@b9g/router";
import {RequestCookieStore} from "@b9g/platform/runtime";
import {
	createSession,
	getSession,
	clearSession,
	type OAuth2Tokens,
} from "../src/index.js";
import {requireAuth} from "../src/middleware.js";

const SECRET = "test-secret-that-is-at-least-32-characters";
const TOKENS: OAuth2Tokens = {
	accessToken: "access-123",
	refreshToken: "refresh-456",
	expiresIn: 3600,
	tokenType: "bearer",
};

// Other test files may install the runtime's cookieStore getter on self,
// so swap the property descriptor rather than assigning
let originalCookieStore: PropertyDescriptor | undefined;
beforeEach(() => {
	originalCookieStore = Object.getOwnPropertyDescriptor(self, "cookieStore");
});
afterEach(() => {
	if (originalCookieStore) {
		Object.defineProperty(self, "cookieStore", originalCookieStore);
	} else {
		delete (self as any).cookieStore;
	}
});

function setCookieStore(store: RequestCookieStore) {
	Object.defineProperty(self, "cookieStore", {
		value: store,
		writable: true,
		configurable: true,
	});
}

/**
 * Create a session with a fresh cookie store and return the cookie value
 */
async function sealedValue(
	tokens: OAuth2Tokens = TOKENS,
	options: {secret?: string; sessionCookieName?: string; maxAge?: number} = {},
): Promise<{value: string; header: string}> {
	const store = new RequestCookieStore();
	await createSession(store, tokens, {secret: SECRET, ...options});
	const header = store.getSetCookieHeaders()[0];
	const cookie = await store.get(options.sessionCookieName || "session");
	return {value: cookie!.value!, header};
}

function protectedRouter() {
	const router = new Router();
	router.use("/dashboard", requireAuth({secret: SECRET}));
	router
		.route("/dashboard")
		.get((_request, context) => Response.json({oauth2: context.oauth2}));
	return router;
}

async function requestDashboard(cookie?: string) {
	const request = new Request("https://app.test/dashboard", {
		headers: cookie ? {cookie} : {},
	});
	setCookieStore(new RequestCookieStore(request));
	return protectedRouter().handle(request);
}

describe("createSession", () => {
	test("sets an HttpOnly, Secure, SameSite=Lax cookie expiring with the token", async () => {
		const before = Date.now();
		const {value, header} = await sealedValue({...TOKENS, expiresIn: 600});

		expect(header).toContain("HttpOnly");
		expect(header).toContain("Secure");
		expect(header).toContain("SameSite=Lax");
		expect(header).toContain("Path=/");

		const expires = Date.parse(/Expires=([^;]+)/.exec(header)![1]);
		expect(expires).toBeGreaterThanOrEqual(before + 599_000);
		expect(expires).toBeLessThanOrEqual(Date.now() + 600_000);

		// The raw tokens are not readable from the cookie
		expect(value).not.toContain(TOKENS.accessToken);
		expect(value).not.toContain(TOKENS.refreshToken!);
	});

	test("requires a secret of at least 32 characters", async () => {
		const store = new RequestCookieStore();
		await expect(
			createSession(store, TOKENS, {secret: "too-short"}),
		).rejects.toThrow(TypeError);
		await expect(createSession(store, TOKENS, {} as any)).rejects.toThrow(
			TypeError,
		);
	});
});

describe("getSession", () => {
	test("round-trips tokens", async () => {
		const {value} = await sealedValue();
		const store = new RequestCookieStore(
			new Request("https://app.test/", {headers: {cookie: `session=${value}`}}),
		);
		expect(await getSession(store, {secret: SECRET})).toEqual(TOKENS);
	});

	test("rejects a value sealed with a different secret", async () => {
		const {value} = await sealedValue(TOKENS, {
			secret: "another-secret-that-is-at-least-32-chars",
		});
		const store = new RequestCookieStore(
			new Request("https://app.test/", {headers: {cookie: `session=${value}`}}),
		);
		expect(await getSession(store, {secret: SECRET})).toBeNull();
	});

	test("rejects a value moved to a different cookie name", async () => {
		const {value} = await sealedValue(TOKENS, {sessionCookieName: "other"});
		const store = new RequestCookieStore(
			new Request("https://app.test/", {headers: {cookie: `session=${value}`}}),
		);
		expect(await getSession(store, {secret: SECRET})).toBeNull();
	});

	test("clearSession removes the session", async () => {
		const {value} = await sealedValue();
		const store = new RequestCookieStore(
			new Request("https://app.test/", {headers: {cookie: `session=${value}`}}),
		);
		await clearSession(store);
		expect(await getSession(store, {secret: SECRET})).toBeNull();
	});
});

describe("requireAuth", () => {
	test("throws without a secret", () => {
		expect(() => (requireAuth as any)()).toThrow(TypeError);
		expect(() => requireAuth({} as any)).toThrow(TypeError);
	});

	test("rejects a missing cookie", async () => {
		const response = await requestDashboard();
		expect(response.status).toBe(401);
	});

	test("rejects an arbitrary unsigned value", async () => {
		const response = await requestDashboard("session=anything");
		expect(response.status).toBe(401);
	});

	test("rejects a raw access token", async () => {
		const response = await requestDashboard(`session=${TOKENS.accessToken}`);
		expect(response.status).toBe(401);
	});

	test("rejects a tampered value", async () => {
		const {value} = await sealedValue();
		const [version, iv, ciphertext] = value.split(".");
		const flipped = (ciphertext[0] === "A" ? "B" : "A") + ciphertext.slice(1);
		for (const forged of [
			`${version}.${iv}.${flipped}`,
			`${version}.${iv}`,
			`v0.${iv}.${ciphertext}`,
			`${value}.extra`,
		]) {
			const response = await requestDashboard(`session=${forged}`);
			expect(response.status).toBe(401);
		}
	});

	test("rejects an expired session", async () => {
		const {value} = await sealedValue(TOKENS, {maxAge: 60});
		const realNow = Date.now;
		Date.now = () => realNow() + 61_000;
		try {
			const response = await requestDashboard(`session=${value}`);
			expect(response.status).toBe(401);
		} finally {
			Date.now = realNow;
		}
	});

	test("puts the session's tokens on context.oauth2", async () => {
		const {value} = await sealedValue();
		const response = await requestDashboard(`session=${value}`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({oauth2: TOKENS});
	});

	test("calls onUnauthorized for invalid sessions", async () => {
		const router = new Router();
		router.use(
			"/dashboard",
			requireAuth({
				secret: SECRET,
				onUnauthorized: () => Response.redirect("https://app.test/login"),
			}),
		);
		router.route("/dashboard").get(() => new Response("private"));
		const request = new Request("https://app.test/dashboard", {
			headers: {cookie: "session=anything"},
		});
		setCookieStore(new RequestCookieStore(request));
		const response = await router.handle(request);
		expect(response.status).toBe(302);
	});
});
