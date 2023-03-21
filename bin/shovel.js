#!/usr/bin/env node --experimental-vm-modules --experimental-fetch --no-warnings
//#!/usr/bin/env node --experimental-vm-modules --experimental-fetch --no-warnings --inspect --inspect-brk
// TODO: Squash warnings from process
// TODO: Figure out how to pass node flags
// https://github.com/yarnpkg/berry/blob/2cf0a8fe3e4d4bd7d4d344245d24a85a45d4c5c9/packages/yarnpkg-pnp/sources/loader/applyPatch.ts#L414-L435

import {Command} from "commander";
import whyIsNodeRunning from "why-is-node-running";

import pkg from "../package.json" assert {type: "json"};
import develop from "../src/develop.js";
const program = new Command();
program
	.name("shovel")
	.version(pkg.version)
	.description("Dig for treasure.");

program.command("develop <file>")
	.option("-p, --port <port>", "Port to listen on", "1337")
	.action(develop);

await program.parseAsync(process.argv);
