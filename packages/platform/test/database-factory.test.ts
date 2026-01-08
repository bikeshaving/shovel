import {test, expect, describe, beforeEach} from "bun:test";
import {createDatabaseFactory} from "../src/runtime.js";
import DefaultDriver, {
	NamedDriver,
	reset,
	lastUrl,
	lastOptions,
	lastDriver,
	closeCalls,
} from "./fixtures/mock-driver.js";

describe("createDatabaseFactory", () => {
	beforeEach(() => {
		reset();
	});

	test("uses impl and passes driver options", async () => {
		const factory = createDatabaseFactory({
			main: {
				impl: DefaultDriver,
				url: "db://main",
				poolSize: 5,
			},
		});

		const {close} = await factory("main");

		expect(lastDriver).toBe("default");
		expect(lastUrl).toBe("db://main");
		expect(lastOptions).toEqual({poolSize: 5});

		await close();
		expect(closeCalls).toBe(1);
	});

	test("uses named impl when configured", async () => {
		const factory = createDatabaseFactory({
			main: {
				impl: NamedDriver,
				url: "db://named",
				ssl: true,
			},
		});

		const {close} = await factory("main");

		expect(lastDriver).toBe("NamedDriver");
		expect(lastUrl).toBe("db://named");
		expect(lastOptions).toEqual({ssl: true});

		await close();
		expect(closeCalls).toBe(1);
	});

	test("throws when impl is missing", async () => {
		const factory = createDatabaseFactory({
			main: {
				url: "db://missing",
			},
		});

		await expect(factory("main")).rejects.toThrow("has no impl");
	});

	test("throws when database is not configured", async () => {
		const factory = createDatabaseFactory({});

		await expect(factory("unknown")).rejects.toThrow("is not configured");
	});
});
