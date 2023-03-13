import * as Path from "path";
import * as VM from "vm";
import * as ESBuild from "esbuild";
import {createServer} from "http";

const path = Path.resolve(process.argv[2]);

let localFetch;

const plugin = {
	name: "loader",
	setup(build) {
		//build.onResolve({filter: /.*/}, (args) => {
		//	//console.log("build.onResolve", args);
		//});

		//build.onLoad({filter: /.*/}, (args) => {
		//	//console.log("build.onLoad", args);
		//});

		build.onEnd(async (result) => {
			console.log("built:", build.initialOptions.entryPoints[0]);
			const module = new VM.SourceTextModule(result.outputFiles[0].text);
			await module.link(async (specifier) => {
				// Where is import relative to???
				const child = await import(specifier);
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
			const rootExports = module.namespace;
			localFetch = rootExports.default?.fetch;
		});
	},
};

const ctx = await ESBuild.context({
	format: "esm",
	//format: "cjs",
	platform: "node",
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
	if (localFetch) {
		const webRes = await localFetch(webReq);
		callNodeResponse(res, webRes);
	}
});

server.listen(8080);
