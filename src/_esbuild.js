import * as ESBuild from "esbuild";

/**
 * @typedef {Object} WatcherEntry
 * @property {string} entry
 * @property {ESBuild.BuildResult} result
 * @property {initial} boolean
 */

export class Watcher {
	/**
	 * @param {(record: WatcherEntry, watcher: Watcher) => any} callback
	 * callback
	 */
	constructor(callback) {
		/** @type {Map<string, WatcherEntry>}	*/
		this._cache = new Map();
		this.callback = callback;
		this.plugin = {
			name: "watcher",
			setup: (build) => {
				/**
				 * @param {ESBuild.BuildResult} result
				 */
				build.onEnd(async (result) => {
					// TODO: errors in this callback seem to be swallowed
					const entry = build.initialOptions.entryPoints[0];
					const cacheValue = this._cache.get(entry);
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

	/**
	 * @returns {Promise<ESBuild.BuildResult>}
	 */
	async build(entry) {
		if (this._cache.has(entry)) {
			return this._cache.get(entry).result;
		}

		const ctxP = ESBuild.context({
			entryPoints: [entry],
			plugins: [this.plugin],
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

		let resolve = null;
		const cacheValue = {
			entry,
			ctx: ctxP,
			result: new Promise((r) => (resolve = r)),
			resolve,
		};

		this._cache.set(entry, cacheValue);
		const ctx = await ctxP;
		ctx.watch();
		cacheValue.ctx = ctx;
		return cacheValue.result;
	}

	async dispose() {
		await Promise.all([...this._cache.values()].map(async (value) => {
			await value.ctx;
			return value.ctx.dispose();
		}));
	}
}
