import * as Path from "path";

export async function develop(entry, options) {
	entry = Path.resolve(process.cwd(), entry);
	const port = parseInt(options.port);
	if (Number.isNaN(port)) {
		throw new Error("Invalid port", options.port);
	}

	const module = await import(entry);
	const server = Bun.serve({
		port,
		async fetch(req) {
			console.log(`${req.method}: ${req.url}`);
			if (typeof module?.default?.fetch === "function") {
				try {
					const res = await module?.default?.fetch(req);
					return res;
				} catch (err)	{
					return new Response(err.stack, {
						status: 500,
					});
				}
			}

			return new Response("fetch not defined on default export", {
				status: 500,
			});
		},
	});

	console.log(`Shovel running on ${server.url}`);
}
