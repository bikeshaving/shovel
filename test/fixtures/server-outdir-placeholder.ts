/// <reference types="@b9g/platform" />
/**
 * Test fixture that uses [outdir] placeholder in directory config.
 * This verifies that __SHOVEL_OUTDIR__ is properly injected by the watcher.
 *
 * The "server" directory uses [outdir]/server by default, which requires
 * __SHOVEL_OUTDIR__ to be defined at build time. Without this define,
 * the generated config will throw ReferenceError at runtime.
 */

self.addEventListener("fetch", (event) => {
	// Try to open a directory that uses [outdir] placeholder
	// This will throw ReferenceError if __SHOVEL_OUTDIR__ is not defined
	event.respondWith(
		(async () => {
			try {
				// self.directories is the ServiceWorkerGlobalScope API
				const serverDir = await self.directories.open("server");
				return new Response(`[outdir] works: ${serverDir.constructor.name}`, {
					headers: {"content-type": "text/plain"},
				});
			} catch (error) {
				return new Response(`Error: ${error}`, {
					status: 500,
					headers: {"content-type": "text/plain"},
				});
			}
		})(),
	);
});
