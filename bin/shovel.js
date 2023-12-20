#!/usr/bin/env node --experimental-vm-modules --experimental-fetch --no-warnings
// TODO: Figure out how to allow debug mode via flags.
//#!/usr/bin/env node --experimental-vm-modules --experimental-fetch --no-warnings --inspect --inspect-brk
//
// TODO: Squash warnings from process
// This code might help
// https://github.com/yarnpkg/berry/blob/2cf0a8fe3e4d4bd7d4d344245d24a85a45d4c5c9/packages/yarnpkg-pnp/sources/loader/applyPatch.ts#L414-L435
import {Command} from "commander";

import pkg from "../package.json" assert {type: "json"};

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
		const {develop} = await import("../src/develop.js");
		await develop(file, options);
	});

program.command("static <file>")
	.description("Build a static site.")
	.option("--out-dir <dir>", "Output directory", "dist")
	.action(async (file, options) => {
		const {static_} = await import("../src/static.js");
		await static_(file, options);
	});

await program.parseAsync(process.argv);
