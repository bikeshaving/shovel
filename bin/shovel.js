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

// TODO: replace with yargs or commander
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

let sourceMapConsumer;
let namespace;
const plugin = {
	name: "loader",
	setup(build) {
		build.onLoad({filter: /\.(js|ts|jsx|tsx)$/}, async (args) => {
			let code = await FS.readFile(args.path, "utf8");
			const magicString = new MagicString(code);
			magicString.prepend(
				`import.meta.url = "${pathToFileURL(args.path).href}";`,
			);

			code = magicString.toString();
			const map = magicString.generateMap({
				file: args.path,
				source: args.path,
				hires: true,
			});

			code = code + "\n//# sourceMappingURL=" + map.toUrl();
			return {
				contents: code,
				loader: Path.extname(args.path).slice(1),
			};
		});

		build.onEnd(async (result) => {
			const url = pathToFileURL(build.initialOptions.entryPoints[0]).href;
			console.log("built:", url);
			if (result.errors && result.errors.length) {
				const formatted = await ESBuild.formatMessages(result.errors, {
					kind: "error",
					color: true,
				});
				console.error(formatted.join("\n"));
				return;
			}

			const code = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
			const map = result.outputFiles.find((file) => file.path.endsWith(".map"))?.text;
			if (map) {
				sourceMapConsumer = await new SourceMapConsumer(map);
			}

			const module = new VM.SourceTextModule(code, {
				identifier: "ESBUILD_VM_RUN",
			});

			try {
				await module.link(async (specifier) => {
					const resolved = await resolve(specifier, cwd);
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
				});

				await module.evaluate();
			} catch (err) {
				if (sourceMapConsumer) {
					fixStack(err, sourceMapConsumer);
				}

				console.error(err);
				return;
			}

			namespace = module.namespace;
		});
	},
};

function fixStack(err, sourceMapConsumer) {
	let [message, ...lines] = err.stack.split("\n");
	lines = lines.map((line, i) => {
		// parse the stack trace line
		return line.replace(
			new RegExp(`ESBUILD_VM_RUN:(\\d+):(\\d+)`),
			(match, line, column) => {
				const pos = sourceMapConsumer.originalPositionFor({
					line: parseInt(line),
					column: parseInt(column),
				});

				const source = pos.source ? Path.resolve(cwd, pos.source) : url;
				return `${pathToFileURL(source)}:${pos.line}:${pos.column}`;
			},
		);
	});
	err.stack = [message, ...lines].join("\n");
}

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
	// We need this to export map files.
	outdir: cwd,
	logLevel: "silent",
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
	// TODO: stream the body
	res.end(await webRes.text());
}

const server = createServer(async (req, res) => {
	const webReq = await webRequestFromNode(req);
	let webRes;
	if (typeof namespace?.default?.fetch === "function") {
		try {
			webRes = await namespace?.default?.fetch(webReq);
		} catch (err)	{
			fixStack(err, sourceMapConsumer);
			webRes = new Response(err.stack, {
				status: 500,
			});
			console.error(err);
		}

	} else {
		// TODO: wait for the server to be ready
		webRes = new Response("Server not running", {
			status: 500,
		});
	}

	callNodeResponse(res, webRes);
});

console.log("listening on port:", port);
server.listen(port);

process.on("uncaughtException", (err) => {
	if (sourceMapConsumer) {
		fixStack(err, sourceMapConsumer);
	}

	console.error(err);
});

process.on("unhandledRejection", (err) => {
	if (sourceMapConsumer) {
		fixStack(err, sourceMapConsumer);
	}

	console.error(err);
});
