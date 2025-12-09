import {
	test,
	expect,
	describe,
	beforeEach,
	afterEach,
	beforeAll,
	afterAll,
	mock,
} from "bun:test";
import {
	CloudflarePlatform,
	createOptionsFromEnv,
	generateWranglerConfig,
} from "../src/index.js";
import {Miniflare} from "miniflare";

describe("CloudflarePlatform", () => {
	let platform: CloudflarePlatform;
	let miniflare: Miniflare;
	let originalCaches: typeof globalThis.caches;

	beforeAll(async () => {
		// Save original caches
		originalCaches = globalThis.caches;

		// Create miniflare instance to provide Cloudflare environment
		miniflare = new Miniflare({
			modules: true,
			script: `export default { fetch() { return new Response("ok"); } }`,
			compatibilityDate: "2024-09-23",
		});

		// Set up globalThis.caches from miniflare

		globalThis.caches =
			(await miniflare.getCaches()) as unknown as CacheStorage;
	});

	afterAll(async () => {
		// Restore original caches
		globalThis.caches = originalCaches;
		await miniflare.dispose();
	});

	beforeEach(() => {
		platform = new CloudflarePlatform({
			environment: "dev",
		});
	});

	afterEach(async () => {
		await platform.dispose();
	});

	test("should have correct name", () => {
		expect(platform.name).toBe("cloudflare");
	});

	test("should create platform with default options", () => {
		const defaultPlatform = new CloudflarePlatform();
		expect(defaultPlatform.name).toBe("cloudflare");
	});

	test("should create cache storage using miniflare caches", async () => {
		// Platform uses native Cloudflare caches (provided by miniflare in tests)
		const caches = await platform.createCaches();
		expect(caches).toBeDefined();

		const cache = await caches.open("test");
		expect(cache).toBeDefined();
	});

	test("should create server with Cloudflare Workers interface", () => {
		const mockHandler = mock(() => new Response("OK"));
		const server = platform.createServer(mockHandler, {
			port: 443,
			host: "cloudflare-workers",
		});

		expect(server).toBeDefined();
		expect(server.address().port).toBe(443);
		expect(server.address().host).toBe("cloudflare-workers");
		expect(server.url).toBe("https://cloudflare-workers");
		expect(server.ready).toBe(true);
	});

	test("should handle server listen and close gracefully", async () => {
		const handler = mock(() => new Response("OK"));
		const server = platform.createServer(handler);

		// Test listen
		await server.listen();

		// Test close
		await server.close();

		// If we got here without errors, listen and close work correctly
		expect(true).toBe(true);
	});

	test.skip("should throw for non-existent worker file", async () => {
		// Skip: miniflare throws synchronously from readFileSync during initialization,
		// which can't be caught by async try/catch or expect().rejects
		let error: Error | undefined;
		try {
			await platform.loadServiceWorker("./non-existent-worker.js");
		} catch (e) {
			error = e as Error;
		}
		expect(error).toBeDefined();
		expect(error?.message).toContain("ENOENT");
	});

	test("should dispose without error", async () => {
		// Should not throw
		await platform.dispose();
		expect(true).toBe(true);
	});
});

describe("Environment utilities", () => {
	test("should create options from environment", () => {
		const env = {
			ENVIRONMENT: "production",
		};

		const options = createOptionsFromEnv(env);

		expect(options.environment).toBe("production");
	});

	test("should default to production environment", () => {
		const options = createOptionsFromEnv({});

		expect(options.environment).toBe("production");
	});
});

describe("Wrangler config generation", () => {
	test("should generate wrangler.toml with basic options", () => {
		const config = generateWranglerConfig({
			name: "my-app",
			entrypoint: "./dist/worker.js",
		});

		expect(config).toContain('name = "my-app"');
		expect(config).toContain('main = "./dist/worker.js"');
		expect(config).toContain('compatibility_date = "2024-09-23"');
		expect(config).toContain('compatibility_flags = ["nodejs_compat"]');
	});

	test("should generate wrangler.toml with R2 filesystem adapter", () => {
		const config = generateWranglerConfig({
			name: "my-app",
			entrypoint: "./dist/worker.js",
			filesystemAdapter: "r2",
		});

		expect(config).toContain("STORAGE_R2");
		expect(config).toContain("bucket_name");
	});

	test("should generate wrangler.toml with custom KV and R2 bindings", () => {
		const config = generateWranglerConfig({
			name: "my-app",
			entrypoint: "./dist/worker.js",
			kvNamespaces: ["CACHE_KV", "DATA_KV"],
			r2Buckets: ["STORAGE_R2", "BACKUP_R2"],
			d1Databases: ["MAIN_DB"],
		});

		expect(config).toContain("CACHE_KV");
		expect(config).toContain("DATA_KV");
		expect(config).toContain("STORAGE_R2");
		expect(config).toContain("BACKUP_R2");
		expect(config).toContain("MAIN_DB");
		expect(config).toContain("database_name");
	});

	test("should handle empty bindings gracefully", () => {
		const config = generateWranglerConfig({
			name: "simple-app",
			entrypoint: "./worker.js",
		});

		// Should not contain binding sections when arrays are empty
		expect(config).not.toContain("[[kv_namespaces]]");
		expect(config).not.toContain("[[r2_buckets]]");
		expect(config).not.toContain("[[d1_databases]]");
	});
});

describe("Cloudflare runtime functions", () => {
	test("should export initializeRuntime and createFetchHandler from runtime", async () => {
		const {initializeRuntime, createFetchHandler} = await import(
			"../src/runtime.js"
		);

		expect(typeof initializeRuntime).toBe("function");
		expect(typeof createFetchHandler).toBe("function");
	});
});
