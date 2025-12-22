import {test, expect, describe, beforeEach} from "bun:test";
import {createDatabaseFactory} from "../src/runtime.js";

const moduleUrl = new URL("./fixtures/mock-driver.js", import.meta.url).href;

async function resetFixture() {
	const mod = await import(moduleUrl);
	mod.reset();
	return mod;
}

describe("createDatabaseFactory", () => {
	beforeEach(async () => {
		await resetFixture();
	});

	test("uses default export and passes driver options", async () => {
		const factory = createDatabaseFactory({
			main: {
				module: moduleUrl,
				url: "db://main",
				poolSize: 5,
			},
		});

		const {close} = await factory("main");
		const mod = await import(moduleUrl);

		expect(mod.lastDriver).toBe("default");
		expect(mod.lastUrl).toBe("db://main");
		expect(mod.lastOptions).toEqual({poolSize: 5});

		await close();
		expect(mod.closeCalls).toBe(1);
	});

	test("uses named export when configured", async () => {
		const factory = createDatabaseFactory({
			main: {
				module: moduleUrl,
				export: "NamedDriver",
				url: "db://named",
				ssl: true,
			},
		});

		const {close} = await factory("main");
		const mod = await import(moduleUrl);

		expect(mod.lastDriver).toBe("NamedDriver");
		expect(mod.lastUrl).toBe("db://named");
		expect(mod.lastOptions).toEqual({ssl: true});

		await close();
		expect(mod.closeCalls).toBe(1);
	});

	test("throws when export is missing", async () => {
		const factory = createDatabaseFactory({
			main: {
				module: moduleUrl,
				export: "MissingDriver",
				url: "db://missing",
			},
		});

		await expect(factory("main")).rejects.toThrow(
			'does not export "MissingDriver"',
		);
	});
});
