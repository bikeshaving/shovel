import {describe, test, expect, beforeEach, afterEach} from "bun:test";
import {RequestCookieStore} from "@b9g/platform/runtime";
import {configure, reset, type LogRecord} from "@logtape/logtape";
import {OAuth2Client} from "../src/index.js";
import {handleCallback} from "../src/middleware.js";

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

describe("handleCallback", () => {
	let logs: LogRecord[];
	let originalFetch: typeof fetch;

	beforeEach(async () => {
		logs = [];
		originalFetch = globalThis.fetch;
		await configure({
			reset: true,
			sinks: {test: (record: LogRecord) => logs.push(record)},
			loggers: [
				{category: ["shovel", "oauth2"], lowestLevel: "debug", sinks: ["test"]},
				{category: ["logtape", "meta"], lowestLevel: "warning", sinks: []},
			],
		});
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		await reset();
	});

	const client = new OAuth2Client({
		authorizationEndpoint: "https://idp.test/authorize",
		tokenEndpoint: "https://idp.test/token",
		clientID: "client",
		clientSecret: "client-secret",
		redirectURI: "https://app.test/callback",
	});

	function callbackRequest(query: string) {
		const request = new Request(`https://app.test/callback?${query}`, {
			headers: {cookie: "oauth_state=STATE; oauth_verifier=VERIFIER"},
		});
		setCookieStore(new RequestCookieStore(request));
		return request;
	}

	test("does not reflect token exchange errors to the client", async () => {
		globalThis.fetch = (async () =>
			new Response(
				'{"error":"invalid_client","debug":"client_secret=abc mismatch"}',
				{status: 401, statusText: "Unauthorized"},
			)) as unknown as typeof fetch;

		const middleware = handleCallback(client, {
			onSuccess: () => new Response("ok"),
		});
		const response = (await middleware(callbackRequest("code=1&state=STATE"), {
			params: {},
		})) as Response;

		expect(response.status).toBe(400);
		const body = await response.text();
		expect(JSON.parse(body)).toEqual({error: "Authentication failed"});
		expect(body).not.toContain("client_secret");

		// Details are logged server-side instead
		expect(logs).toHaveLength(1);
		expect(logs[0].level).toBe("error");
		expect(String((logs[0].properties.error as Error).message)).toContain(
			"client_secret=abc mismatch",
		);
	});

	test("does not reflect provider error descriptions", async () => {
		const middleware = handleCallback(client, {
			onSuccess: () => new Response("ok"),
		});
		const response = (await middleware(
			callbackRequest("error=x&error_description=%3Cscript%3E"),
			{params: {}},
		)) as Response;

		expect(response.status).toBe(400);
		expect(await response.text()).not.toContain("<script>");
	});

	test("still rejects a state mismatch", async () => {
		let fetched = false;
		globalThis.fetch = (async () => {
			fetched = true;
			return Response.json({access_token: "x"});
		}) as unknown as typeof fetch;

		const middleware = handleCallback(client, {
			onSuccess: () => new Response("ok"),
		});
		const response = (await middleware(callbackRequest("code=1&state=WRONG"), {
			params: {},
		})) as Response;

		expect(response.status).toBe(400);
		expect(fetched).toBe(false);
	});

	test("exchanges the code with the PKCE verifier and fixed redirect_uri", async () => {
		let body: URLSearchParams | undefined;
		globalThis.fetch = (async (_url: string, init: RequestInit) => {
			body = new URLSearchParams(init.body as string);
			return Response.json({access_token: "access", expires_in: 60});
		}) as unknown as typeof fetch;

		const middleware = handleCallback(client, {
			onSuccess: (tokens) => Response.json(tokens),
		});
		const response = (await middleware(
			callbackRequest("code=CODE&state=STATE&redirect_uri=https://evil.test"),
			{params: {}},
		)) as Response;

		expect(response.status).toBe(200);
		expect(body!.get("code_verifier")).toBe("VERIFIER");
		expect(body!.get("redirect_uri")).toBe("https://app.test/callback");
	});
});
