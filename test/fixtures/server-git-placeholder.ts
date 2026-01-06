/// <reference types="@b9g/platform" />
/**
 * Test fixture that accesses __SHOVEL_GIT__ directly.
 * This verifies that the git commit SHA is properly injected by the watcher.
 *
 * The __SHOVEL_GIT__ constant is injected at build time by esbuild.
 * Without this define, the generated code will throw ReferenceError at runtime.
 */

// Declare the build-time constant
declare const __SHOVEL_GIT__: string;

self.addEventListener("fetch", (event) => {
	event.respondWith(
		(async () => {
			try {
				// Access the git SHA constant directly
				// This will throw ReferenceError if __SHOVEL_GIT__ is not defined
				const gitSha = __SHOVEL_GIT__;
				return new Response(`[git] works: ${gitSha}`, {
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
