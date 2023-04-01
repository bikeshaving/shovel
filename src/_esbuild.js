import * as ESBuild from "esbuild";
function createESBuildContext(entry, plugins) {
	return ESBuild.context({
		entryPoints: [entry],
		plugins,
		format: "esm",
		platform: "node",
		bundle: false,
		metafile: true,
		write: false,
		packages: "external",
		sourcemap: "both",
		// We need this to export map files.
		outdir: "dist",
		logLevel: "silent",
	});
}

export class Watcher {
	constructor(callback) {
		this.cache = new Map();
		this.callback = callback;
		this.plugin = {
			name: "watcher",
			setup: (build) => {
				build.onEnd(async (result) => {
					// TODO: errors in this callback seem to be swallowed
					const entry = build.initialOptions.entryPoints[0];
					const cacheValue = this.cache.get(entry);
					const initial = cacheValue.resolve != null;
					if (cacheValue.resolve) {
						cacheValue.resolve(result);
						cacheValue.resolve = null;
					}

					cacheValue.result = result;
					try {
						await callback({entry, result, initial}, this);
					} catch (err) {
						console.error(err);
					}
				});
			},
		};
	}

	build(entry) {
		if (this.cache.has(entry)) {
			return this.cache.get(entry).result;
		}

		const ctxP = createESBuildContext(entry, [this.plugin]);
		let resolve = null;
		const cacheValue = {
			entry,
			ctx: ctxP,
			result: new Promise((r) => (resolve = r)),
			resolve,
		};
		this.cache.set(entry, cacheValue);
		ctxP.then((ctx) => {
			ctx.watch();
			cacheValue.ctx = ctx;
		});

		return cacheValue.result;
	}

	async dispose() {
		for (const {ctx} of this.cache.values()) {
			await ctx.dispose();
		}
	}
}

/**
 * @param {string} entry - An absolute path to the entry point.
 * @returns {Promise<import("esbuild").BuildResult>}
 */
export async function build(entry) {
	const ctx = await createESBuildContext(entry, []);
	const result = await ctx.build();
	return result;
}
