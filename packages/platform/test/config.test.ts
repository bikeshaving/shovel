import {test, expect} from "bun:test";
import {loadConfig} from "../src/config.ts";
import {mkdtempSync, writeFileSync, rmSync} from "fs";
import {tmpdir} from "os";
import {join} from "path";

test("loadConfig: loads from shovel.json if present", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "shovel-config-test-"));

	try {
		// Create shovel.json
		writeFileSync(
			join(tmpDir, "shovel.json"),
			JSON.stringify({
				port: 4000,
				host: "0.0.0.0", // IP addresses are stored as strings in JSON
				workers: 4,
				caches: {
					"api:*": {maxEntries: 500},
				},
			}),
		);

		const config = loadConfig(tmpDir);

		expect(config.port).toBe(4000);
		expect(config.host).toBe("0.0.0.0"); // Should preserve IP address
		expect(config.workers).toBe(4);
		expect(config.caches["api:*"]).toEqual({maxEntries: 500});
	} finally {
		rmSync(tmpDir, {recursive: true});
	}
});

test("loadConfig: falls back to package.json shovel field", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "shovel-config-test-"));

	try {
		// Create package.json with shovel field
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "test-app",
				shovel: {
					port: 5000,
					host: "127.0.0.1",
					workers: 2,
				},
			}),
		);

		const config = loadConfig(tmpDir);

		expect(config.port).toBe(5000);
		expect(config.host).toBe("127.0.0.1"); // Should preserve IP address
		expect(config.workers).toBe(2);
	} finally {
		rmSync(tmpDir, {recursive: true});
	}
});

test("loadConfig: shovel.json takes precedence over package.json", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "shovel-config-test-"));

	try {
		// Create both files
		writeFileSync(
			join(tmpDir, "shovel.json"),
			JSON.stringify({
				port: 6000,
				workers: 8,
			}),
		);

		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "test-app",
				shovel: {
					port: 7000,
					workers: 4,
				},
			}),
		);

		const config = loadConfig(tmpDir);

		// Should use shovel.json values
		expect(config.port).toBe(6000);
		expect(config.workers).toBe(8);
	} finally {
		rmSync(tmpDir, {recursive: true});
	}
});

test("loadConfig: uses defaults when no config files exist", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "shovel-config-test-"));

	try {
		const config = loadConfig(tmpDir);

		// Default values
		expect(config.port).toBe(3000);
		expect(config.host).toBe("localhost");
		expect(config.workers).toBe(1);
		expect(config.caches).toEqual({});
		expect(config.buckets).toEqual({});
	} finally {
		rmSync(tmpDir, {recursive: true});
	}
});

test("loadConfig: processes environment variable expressions", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "shovel-config-test-"));

	try {
		// Set test env var
		// eslint-disable-next-line no-restricted-properties
		const originalPort = process.env.TEST_PORT;
		// eslint-disable-next-line no-restricted-properties
		process.env.TEST_PORT = "9000";

		writeFileSync(
			join(tmpDir, "shovel.json"),
			JSON.stringify({
				port: "TEST_PORT", // ALL_CAPS = env var (no $ prefix needed)
			}),
		);

		const config = loadConfig(tmpDir);

		expect(config.port).toBe(9000);

		// Cleanup
		if (originalPort !== undefined) {
			// eslint-disable-next-line no-restricted-properties
			process.env.TEST_PORT = originalPort;
		} else {
			// eslint-disable-next-line no-restricted-properties
			delete process.env.TEST_PORT;
		}
	} finally {
		rmSync(tmpDir, {recursive: true});
	}
});

test("loadConfig: handles partial config with defaults", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "shovel-config-test-"));

	try {
		// Only specify port
		writeFileSync(
			join(tmpDir, "shovel.json"),
			JSON.stringify({
				port: 8080,
			}),
		);

		const config = loadConfig(tmpDir);

		expect(config.port).toBe(8080);
		// Should use defaults for other fields
		expect(config.host).toBe("localhost");
		expect(config.workers).toBe(1);
	} finally {
		rmSync(tmpDir, {recursive: true});
	}
});
