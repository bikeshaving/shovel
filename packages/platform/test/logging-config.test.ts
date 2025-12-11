/**
 * Tests for logging configuration behavior
 *
 * Specifically tests that:
 * - Loggers without explicit sinks default to ["console"]
 * - User loggers that override shovel defaults still get sinks
 */

/* eslint-disable no-console -- Tests need to mock console methods */

import {describe, it, expect, beforeEach, afterEach, mock} from "bun:test";
import {getLogger, configure} from "@logtape/logtape";
import {configureLogging} from "../src/runtime.js";

describe("configureLogging", () => {
	// Capture console output for verification
	let consoleDebug: ReturnType<typeof mock>;
	let consoleInfo: ReturnType<typeof mock>;
	let consoleWarn: ReturnType<typeof mock>;
	let originalDebug: typeof console.debug;
	let originalInfo: typeof console.info;
	let originalWarn: typeof console.warn;

	beforeEach(() => {
		originalDebug = console.debug;
		originalInfo = console.info;
		originalWarn = console.warn;
		consoleDebug = mock(() => {});
		consoleInfo = mock(() => {});
		consoleWarn = mock(() => {});
		console.debug = consoleDebug;
		console.info = consoleInfo;
		console.warn = consoleWarn;
	});

	afterEach(async () => {
		console.debug = originalDebug;
		console.info = originalInfo;
		console.warn = originalWarn;
		// Reset logtape
		await configure({reset: true, sinks: {}, loggers: []});
	});

	it("defaults to console sink when logger has no sinks specified", async () => {
		await configureLogging({
			loggers: [
				{
					category: ["test", "nosink"],
					level: "debug",
					// No sinks specified - should default to ["console"]
				},
			],
		});

		const logger = getLogger(["test", "nosink"]);
		logger.debug("test message");

		// Should have output to console.debug
		expect(consoleDebug).toHaveBeenCalled();
	});

	it("keeps explicit sinks when specified", async () => {
		await configureLogging({
			loggers: [
				{
					category: ["test", "explicit"],
					level: "debug",
					sinks: ["console"],
				},
			],
		});

		const logger = getLogger(["test", "explicit"]);
		logger.debug("explicit sink message");

		expect(consoleDebug).toHaveBeenCalled();
	});

	it("user logger overriding shovel default still outputs", async () => {
		// This is the key bug that was fixed:
		// User specifies {category: "shovel", level: "debug"} without sinks
		// This should still output because sinks default to ["console"]
		await configureLogging({
			loggers: [
				{
					category: "shovel", // Override the default shovel logger
					level: "debug",
					// No sinks - previously this caused no output
				},
			],
		});

		const logger = getLogger(["shovel", "test"]);
		logger.debug("shovel debug message");

		expect(consoleDebug).toHaveBeenCalled();
	});

	it("preserves shovel defaults when user adds new category", async () => {
		await configureLogging({
			loggers: [
				{
					category: ["myapp"],
					level: "debug",
				},
			],
		});

		// User logger should work
		const myLogger = getLogger(["myapp"]);
		myLogger.debug("myapp message");
		expect(consoleDebug).toHaveBeenCalled();

		// Shovel default should still work (at info level)
		const shovelLogger = getLogger(["shovel", "test"]);
		shovelLogger.info("shovel info");
		expect(consoleInfo).toHaveBeenCalled();
	});

	it("empty sinks array results in no output", async () => {
		// Explicit empty array should be respected
		await configureLogging({
			loggers: [
				{
					category: ["test", "silent"],
					level: "debug",
					sinks: [], // Explicitly no sinks
				},
			],
		});

		const logger = getLogger(["test", "silent"]);
		logger.debug("silent message");

		// Should not output
		expect(consoleDebug).not.toHaveBeenCalled();
	});
});
