import * as FS from "fs/promises";
import {suite} from "uvu";
import * as Assert from "uvu/assert";
import * as Sinon from "sinon";
import * as ChildProcess from "child_process";
import whyIsNodeRunning from "why-is-node-running";
import fkill from "fkill";

const test = suite("develop");

const PORT = "1339";
test.after.each(async () => {
	await fkill(`:${PORT}`);
});

test("basic", async () => {
	const shovel = ChildProcess.spawn("shovel", ["develop", "./fixtures/poop.ts", "--port", PORT]);
	const serverIsRunning = async () => {
		try {
			const response = await fetch(`http://localhost:${PORT}`);
			return await response.text();
		} catch (err) {
			return false;
		}
	};

	let isRunning = false;
	let tries = 0;
	while (!isRunning) {
		if (tries > 30) {
			throw new Error("Server never started");
		}

		isRunning = await serverIsRunning();
		if (!isRunning) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}

	Assert.equal(isRunning, "<marquee>Hello world</marquee>");
});

test("restarts on file change", async () => {
	const shovel = ChildProcess.spawn("shovel", ["develop", "./fixtures/poop.ts", "--port", PORT]);

	const serverIsRunning = async () => {
		try {
			const response = await fetch(`http://localhost:${PORT}`);
			return await response.text();
		} catch (err) {
			return false;
		}
	};

	let isRunning = false;
	let tries = 0;
	while (!isRunning) {
		if (tries > 30) {
			throw new Error("Server never started");
		}

		isRunning = await serverIsRunning();
		if (!isRunning) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}

	Assert.equal(isRunning, "<marquee>Hello world</marquee>");

	try {
		await FS.copyFile("./fixtures/poop.ts", "./fixtures/poop.ts.bak");
		await FS.copyFile("./fixtures/poop1.ts", "./fixtures/poop.ts");
		await new Promise((resolve) => setTimeout(resolve, 1000));

		const response = await fetch(`http://localhost:${PORT}`);
		const text = await response.text();

		Assert.equal(text, "<marquee>Goodbye world</marquee>");
	} finally {
		await FS.rename("./fixtures/poop.ts.bak", "./fixtures/poop.ts");
	}
});

test.run();
