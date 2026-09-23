import {beforeEach, describe, expect, test} from "bun:test";

import {createDatabaseFactory} from "../src/runtime.js";
import DefaultDriver, {
	calls,
	NamedDriver,
	reset,
} from "./fixtures/mock-driver.js";

describe("createDatabaseFactory", () => {
	beforeEach(() => {
		reset();
	});

	test("uses impl and passes driver options", async () => {
		const factory = createDatabaseFactory({
			main: {impl: DefaultDriver, url: "db://main", poolSize: 5},
		});

		const {close} = await factory("main");

		expect(calls.driver).toBe("default");
		expect(calls.url).toBe("db://main");
		expect(calls.options).toEqual({poolSize: 5});

		await close();
		expect(calls.close).toBe(1);
	});

	test("uses named impl when configured", async () => {
		const factory = createDatabaseFactory({
			main: {impl: NamedDriver, url: "db://named", ssl: true},
		});

		const {close} = await factory("main");

		expect(calls.driver).toBe("NamedDriver");
		expect(calls.url).toBe("db://named");
		expect(calls.options).toEqual({ssl: true});

		await close();
		expect(calls.close).toBe(1);
	});

	test("throws when impl is missing", async () => {
		const factory = createDatabaseFactory({main: {url: "db://missing"}});

		await expect(factory("main")).rejects.toThrow("has no impl");
	});

	test("throws when database is not configured", async () => {
		const factory = createDatabaseFactory({});

		await expect(factory("unknown")).rejects.toThrow("is not configured");
	});
});
