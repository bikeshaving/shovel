#!/usr/bin/env node --experimental-vm-modules --experimental-fetch --no-warnings
import * as Path from "path";
import * as FS from "fs/promises";
import {createServer} from "http";
import * as VM from "vm";
import {pathToFileURL} from "url";
import {parseArgs} from "@pkgjs/parseargs";
import * as ESBuild from "esbuild";

import resolve from "../resolve.js";

const {values, positionals} = parseArgs({
	allowPositionals: true,
	options: {
		port: {
			type: "string",
		},
	},
});

const path = Path.resolve(positionals[0] || "");
const cwd = process.cwd();
const port = parseInt(values["port"] || "1337");

let localFetch, localCleanup;
const plugin = {
	name: "loader",
	setup(build) {
		//build.onResolve({filter: /.*/}, (args) => {
		//	console.log("build.onResolve", args);
		//});

		// inject import.meta.url
		// TODO: correct filters
		build.onLoad({filter: /.*/}, async (args) => {
			let file = await FS.readFile(args.path, "utf8");
			// TODO: sourcemap!!!
			file = `import.meta.url = "${pathToFileURL(args.path).href}";${file}`;
			// TODO: get the correct loader
			return {contents: file, loader: "ts"};
		});

		// TODO: Error handling
		build.onEnd(async (result) => {
			console.log("built:", build.initialOptions.entryPoints[0]);
			// TODO: handle build errors
			if (result.errors && result.errors.length) {
				console.error("build has errors", result.errors);
				return;
			}

			const module = new VM.SourceTextModule(result.outputFiles[0].text, {
				identifier: build.initialOptions.entryPoints[0],
			});
			await module.link(async (specifier) => {
				const resolved = await resolve(specifier, cwd);
				//console.log("resolved:", specifier, resolved);
				try {
					const child = await import(resolved);
					const exports = Object.keys(child);
					return new VM.SyntheticModule(
						exports,
						function () {
							for (const key of exports) {
								this.setExport(key, child[key]);
							}
						},
					);
				} catch (err) {
					// TODO: Figure out how to catch this error in the outer scope
					console.error("await import threw", err);
					return new VM.SyntheticModule([], function () {});
				}
			});

			try {
				await module.evaluate();
			} catch (err) {
				console.error("module.evaluate() threw", err);
			}

			if (localCleanup) {
				localCleanup();
			}

			localFetch = module.namespace.default?.fetch;
			localCleanup = module.namespace.default?.cleanup;
		});
	},
};

const ctx = await ESBuild.context({
	format: "esm",
	platform: "node",
	absWorkingDir: cwd,
	entryPoints: [path],
	bundle: true,
	metafile: true,
	packages: "external",
	write: false,
	plugins: [plugin],
});

await ctx.watch();

function readableStreamFromMessage(req) {
	return new ReadableStream({
		start(controller) {
			req.on("data", (chunk) => {
				controller.enqueue(chunk);
			});
			req.on("end", () => {
				controller.close();
			});
		},

		cancel() {
			req.destroy();
		},
	});
}

async function webRequestFromNode(req) {
	const url = new URL(req.url || "/", "http://localhost");

	const headers = new Headers();
	for (const key in req.headers) {
		if (req.headers[key]) {
			headers.append(key, req.headers[key]);
		}
	}

	return new Request(url, {
		method: req.method,
		headers,
		body: req.method === "GET" || req.method === "HEAD" ? undefined : readableStreamFromMessage(req),
	});
}

async function callNodeResponse(res, webRes) {
	const headers = {};
	webRes.headers.forEach((value, key) => {
		headers[key] = value;
	});
	res.writeHead(webRes.status, headers);
	res.end(await webRes.text());
}

const server = createServer(async (req, res) => {
	const webReq = await webRequestFromNode(req);
	// TODO: wait for localFetch to be set
	if (localFetch) {
		const webRes = await localFetch(webReq);
		callNodeResponse(res, webRes);
	}
});

console.log("listening on port:", port);
server.listen(port);
