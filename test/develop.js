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
	try {
		await fkill(`:${PORT}`);
	} catch (err) {
		// uvu test hooks seem to fail silently...
		console.error(err);
	}
});

// TODO: wait for server to be ready rather than retrying
test("basic", async () => {
	const shovel = ChildProcess.spawn(
		"shovel",
		["develop", "./fixtures/server-hello.ts", "--port", PORT],
	);
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

test("restarts on change to root", async () => {
	const shovel = ChildProcess.spawn(
		"shovel",
		["develop", "./fixtures/server-hello.ts", "--port", PORT],
		{stdio: "inherit"},
	);

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

	const serverHelloContents = await FS.readFile(
		"./fixtures/server-hello.ts",
		"utf8",
	);

	try {
		await FS.copyFile(
			"./fixtures/server-goodbye.ts",
			"./fixtures/server-hello.ts",
		);
		// TODO: wait for server to restart
		await new Promise((resolve) => setTimeout(resolve, 1000));

		const response = await fetch(`http://localhost:${PORT}`);
		const text = await response.text();

		Assert.equal(text, "<marquee>Goodbye world</marquee>");
	} finally {
		await FS.writeFile("./fixtures/server-hello.ts", serverHelloContents);
	}
});

test("restarts on change to dependency", async () => {
	const shovel = ChildProcess.spawn(
		"shovel",
		["develop", "./fixtures/server-dependent.ts", "--port", PORT],
		{stdio: "inherit"},
	);

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

	Assert.equal(isRunning, "<marquee>Hello from dependency-hello.ts</marquee>");
	const serverDependencyContents = await FS.readFile(
		"./fixtures/server-dependency-hello.ts",
		"utf8",
	);

	try {
		await FS.copyFile(
			"./fixtures/server-dependency-goodbye.ts",
			"./fixtures/server-dependency-hello.ts",
		);

		await new Promise((resolve) => setTimeout(resolve, 1000));
		const response = await fetch(`http://localhost:${PORT}`);
		const text = await response.text();

		Assert.equal(text, "<marquee>Goodbye from dependency-hello.ts</marquee>");
	} finally {
		await FS.writeFile(
			"./fixtures/server-dependency-hello.ts",
			serverDependencyContents,
		);
	}
});

test.run();
