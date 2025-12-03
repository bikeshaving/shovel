import {test, expect, describe} from "bun:test";
import {
	loadConfig,
	configureLogging,
	type ProcessedLoggingConfig,
} from "../src/config.ts";
import {mkdtempSync, writeFileSync, rmSync} from "fs";
import {tmpdir} from "os";
import {join} from "path";
import {getLogger, reset as resetLogtape} from "@logtape/logtape";

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

// ============================================================================
// LOGGING CONFIGURATION TESTS
// ============================================================================

test("loadConfig: uses default logging config (console sink, info level)", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "shovel-config-test-"));

	try {
		const config = loadConfig(tmpDir);

		// Default logging config
		expect(config.logging.level).toBe("info");
		expect(config.logging.sinks).toEqual([{provider: "console"}]);
		expect(config.logging.categories).toEqual({});
	} finally {
		rmSync(tmpDir, {recursive: true});
	}
});

test("loadConfig: handles custom logging level", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "shovel-config-test-"));

	try {
		writeFileSync(
			join(tmpDir, "shovel.json"),
			JSON.stringify({
				logging: {
					level: "debug",
				},
			}),
		);

		const config = loadConfig(tmpDir);

		expect(config.logging.level).toBe("debug");
		// Default sink when not specified
		expect(config.logging.sinks).toEqual([{provider: "console"}]);
	} finally {
		rmSync(tmpDir, {recursive: true});
	}
});

test("loadConfig: handles custom sinks configuration", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "shovel-config-test-"));

	try {
		writeFileSync(
			join(tmpDir, "shovel.json"),
			JSON.stringify({
				logging: {
					level: "info",
					sinks: [{provider: "console"}, {provider: "file", path: "app.log"}],
				},
			}),
		);

		const config = loadConfig(tmpDir);

		expect(config.logging.level).toBe("info");
		expect(config.logging.sinks).toEqual([
			{provider: "console"},
			{provider: "file", path: "app.log"},
		]);
	} finally {
		rmSync(tmpDir, {recursive: true});
	}
});

test("loadConfig: handles category-specific logging config", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "shovel-config-test-"));

	try {
		writeFileSync(
			join(tmpDir, "shovel.json"),
			JSON.stringify({
				logging: {
					level: "info",
					sinks: [{provider: "console"}],
					categories: {
						worker: {
							level: "debug",
						},
						router: {
							level: "warning",
							sinks: [{provider: "file", path: "router.log"}],
						},
					},
				},
			}),
		);

		const config = loadConfig(tmpDir);

		expect(config.logging.level).toBe("info");
		expect(config.logging.sinks).toEqual([{provider: "console"}]);
		expect(config.logging.categories).toEqual({
			worker: {level: "debug"},
			router: {
				level: "warning",
				sinks: [{provider: "file", path: "router.log"}],
			},
		});
	} finally {
		rmSync(tmpDir, {recursive: true});
	}
});

test("loadConfig: handles rotating file sink configuration", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "shovel-config-test-"));

	try {
		writeFileSync(
			join(tmpDir, "shovel.json"),
			JSON.stringify({
				logging: {
					sinks: [
						{
							provider: "rotating",
							path: "app.log",
							maxSize: 10485760,
							maxFiles: 5,
						},
					],
				},
			}),
		);

		const config = loadConfig(tmpDir);

		expect(config.logging.sinks).toEqual([
			{
				provider: "rotating",
				path: "app.log",
				maxSize: 10485760,
				maxFiles: 5,
			},
		]);
	} finally {
		rmSync(tmpDir, {recursive: true});
	}
});

// ============================================================================
// configureLogging TESTS
// ============================================================================

describe("configureLogging", () => {
	test("configures LogTape with default console sink", async () => {
		await resetLogtape();

		const loggingConfig: ProcessedLoggingConfig = {
			level: "info",
			sinks: [{provider: "console"}],
			categories: {},
		};

		await configureLogging(loggingConfig);

		// Verify logger works (if it throws, the test fails)
		const logger = getLogger(["cli"]);
		expect(logger).toBeDefined();

		await resetLogtape();
	});

	test("configures LogTape with category-specific levels", async () => {
		await resetLogtape();

		const loggingConfig: ProcessedLoggingConfig = {
			level: "info",
			sinks: [{provider: "console"}],
			categories: {
				worker: {level: "debug"},
			},
		};

		await configureLogging(loggingConfig);

		// Verify loggers are created
		const workerLogger = getLogger(["worker"]);
		const routerLogger = getLogger(["router"]);
		expect(workerLogger).toBeDefined();
		expect(routerLogger).toBeDefined();

		await resetLogtape();
	});

	test("throws error for unknown sink provider", async () => {
		await resetLogtape();

		const loggingConfig: ProcessedLoggingConfig = {
			level: "info",
			sinks: [{provider: "nonexistent-provider-xyz"}],
			categories: {},
		};

		await expect(configureLogging(loggingConfig)).rejects.toThrow(
			/nonexistent-provider-xyz/,
		);

		await resetLogtape();
	});

	test("handles multiple sinks", async () => {
		await resetLogtape();

		// Using only console since file sinks require additional packages
		const loggingConfig: ProcessedLoggingConfig = {
			level: "info",
			sinks: [
				{provider: "console"},
				{provider: "console"}, // Duplicate for testing multiple sinks
			],
			categories: {},
		};

		await configureLogging(loggingConfig);

		const logger = getLogger(["cli"]);
		expect(logger).toBeDefined();

		await resetLogtape();
	});

	test("handles category with different sinks than default", async () => {
		await resetLogtape();

		const loggingConfig: ProcessedLoggingConfig = {
			level: "info",
			sinks: [{provider: "console"}],
			categories: {
				router: {
					level: "debug",
					sinks: [{provider: "console"}], // Different sink config for router
				},
			},
		};

		await configureLogging(loggingConfig);

		const routerLogger = getLogger(["router"]);
		expect(routerLogger).toBeDefined();

		await resetLogtape();
	});
});
