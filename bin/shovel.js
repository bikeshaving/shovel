#!/usr/bin/env bun
import {Command} from "commander";
import pkg from "../package.json" with {type: "json"};

process.title = "shovel";
const program = new Command();
program
	.name("shovel")
	.version(pkg.version)
	.description("Dig for treasure.");

program.command("develop <file>")
	.description("Start a development server.")
	.option("-p, --port <port>", "Port to listen on", "1337")
	.action(async (file, options) => {
		if (!process.env.SHOVEL_DEVELOP_WATCH) {
			const shovelPath = new URL(import.meta.resolve("./shovel.js")).pathname;
			const proc = Bun.spawn(["bun", "run", "--watch", shovelPath, "develop", file, "--port", options.port], {
				stdout: "inherit",
				stderr: "inherit",
				env: {
					...process.env,
					SHOVEL_DEVELOP_WATCH: 1,
				},
			});

			await proc.exited;
			return;
		}

		const {develop} = await import("../src/develop.js");
		await develop(file, options);
	});

program.command("static <file>")
	.description("Build a static site.")
	.option("--out-dir <dir>", "Output directory", "dist")
	.action(async (file, options) => {
		throw new Error("TODO: fix this");
		const {static_} = await import("../src/static.js");
		await static_(file, options);
	});

await program.parseAsync(process.argv);
