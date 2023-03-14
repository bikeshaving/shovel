#!/usr/bin/env node --experimental-vm-modules --experimental-fetch --no-warnings
import * as Path from "path";
import * as FS from "fs/promises";
import {createServer} from "http";
import * as VM from "vm";
import {pathToFileURL} from "url";
import {parseArgs} from "@pkgjs/parseargs";
import * as ESBuild from "esbuild";
import {SourceMapConsumer} from "source-map";
import MagicString from "magic-string";
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

let namespace;
const plugin = {
	name: "loader",
	setup(build) {
		// TODO: correct filters
		build.onLoad({filter: /.*/}, async (args) => {
			let file = await FS.readFile(args.path, "utf8");
			const magicString = new MagicString(file);
			magicString.prepend(`import.meta.url = "${pathToFileURL(args.path).href}";`);

			file = magicString.toString();
			const map = magicString.generateMap({
				file: args.path,
				source: args.path,
			});

			file = file + "\n//# sourceMappingURL=" + map.toUrl();
			// TODO: get the correct loader
			return {contents: file, loader: "ts"};
		});

		// TODO: Error handling
		build.onEnd(async (result) => {
			const url = pathToFileURL(build.initialOptions.entryPoints[0]).href;
			console.log("built:", url);
			// TODO: handle build errors
			if (result.errors && result.errors.length) {
				console.error("build has errors", result.errors);
				return;
			}

			const map = result.outputFiles.find((file) => file.path.endsWith(".map"))?.text;
			const code = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text;

			const module = new VM.SourceTextModule(code, {
				identifier: url,
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
				if (map) {
					const consumer = await new SourceMapConsumer(map);
					let [message, ...lines] = err.stack.split("\n");
					lines = lines.map((line) => {
						// parse the stack trace line
						return line.replace(new RegExp(`${url}:(\\d+):(\\d+)`), (match, line, column) => {
							const pos = consumer.originalPositionFor({
								line: parseInt(line),
								column: parseInt(column),
							});

							return `${pos.source}:${pos.line}:${pos.column}`;
						});
					});
					err.stack = [message, ...lines].join("\n");
				}

				console.log("module.evaluate threw", err);
				//const stack = new StackTracey(err);
				//console.log(stack.items);
			}

			namespace?.cleanup?.();
			namespace = module.namespace;
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
	write: false,
	packages: "external",
	sourcemap: "both",
	plugins: [plugin],
	outdir: cwd,
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
	const url = new URL(req.url || "/", "http://" + req.headers.host);
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
	if (namespace?.fetch) {
		const webRes = await namespace?.fetch(webReq);
		callNodeResponse(res, webRes);
	} else {
		res.write("waiting for namespace to be set");
		res.end();
	}
});

console.log("listening on port:", port);
server.listen(port);
