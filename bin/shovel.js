#!/usr/bin/env node --experimental-vm-modules --experimental-fetch --no-warnings
import * as Path from "path";
import * as FS from "fs/promises";
import * as VM from "vm";
import * as ESBuild from "esbuild";
import {createServer} from "http";
import {promisify} from "util";
import resolve from "../resolve.js";

// TODO: get port from argv
const path = Path.resolve(process.argv[2]);
const cwd = process.cwd();
let localFetch;

const plugin = {
	name: "loader",
	setup(build) {
		//build.onResolve({filter: /.*/}, (args) => {
		//	console.log("build.onResolve", args);
		//});

		build.onLoad({filter: /.*/}, async (args) => {
			let file = await FS.readFile(args.path, "utf8");
			// TODO: sourcemap
			// TODO: get the correct loader
			file = `import.meta.url = "${new URL(args.path, "file:///").href}";\n` + file;
			return {contents: file, loader: "ts"};
		});

		build.onEnd(async (result) => {
			console.log("built:", build.initialOptions.entryPoints[0]);
			// TODO: handle build errors
			//console.log(result.errors);
			const module = new VM.SourceTextModule(result.outputFiles[0].text, {
				identifier: build.initialOptions.entryPoints[0],
			});
			await module.link(async (specifier) => {
				const resolved = await resolve(specifier, {basedir: cwd});
				console.log("resolved:", specifier, resolved);
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
					console.error("await import threw", err);
					return new VM.SyntheticModule([], function () {});
				}
			});

			try {
				await module.evaluate();
			} catch (err) {
				console.error("module.evaluate() threw", err);
			}
			const rootExports = module.namespace;
			localFetch = rootExports.default?.fetch;
		});
	},
};

const ctx = await ESBuild.context({
	format: "esm",
	platform: "node",
	absWorkingDir: process.cwd(),
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

server.listen(8080);
