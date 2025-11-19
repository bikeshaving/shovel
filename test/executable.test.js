import {test, expect} from "bun:test";
import * as FS from "fs/promises";
import {spawn} from "child_process";
import {tmpdir} from "os";
import {join} from "path";

/**
 * Directly executable builds integration tests
 * Tests the end-to-end functionality of self-contained executable builds
 */

const TIMEOUT = 5000;

// Helper functions
async function createTempDir(prefix = "executable-test-") {
	const tempPath = join(tmpdir(), `${prefix}${Date.now()}`);
	await FS.mkdir(tempPath, {recursive: true});
	return tempPath;
}

async function createTempFile(dir, filename, content) {
	const filePath = join(dir, filename);
	await FS.writeFile(filePath, content, "utf8");
	return filePath;
}

async function cleanup(paths) {
	for (const path of paths) {
		try {
			await FS.rm(path, {recursive: true, force: true});
		} catch {
			// Already removed
		}
	}
}

// Helper to wait for server to be ready
async function waitForServer(port, host = "localhost", timeoutMs = 2000) {
	const startTime = Date.now();

	while (Date.now() - startTime < timeoutMs) {
		try {
			const response = await fetch(`http://${host}:${port}`);
			if (response.ok || response.status < 500) {
				return await response.text();
			}
		} catch (err) {
			// Server not ready yet, continue waiting
		}

		await new Promise((resolve) => setTimeout(resolve, 50));
	}

	throw new Error(
		`Server at port ${port} never became ready within ${timeoutMs}ms`,
	);
}

// Helper to run executable and get process
function runExecutable(executablePath, env = {}) {
	const proc = spawn("node", [executablePath], {
		stdio: ["ignore", "pipe", "pipe"],
		env: {...process.env, ...env},
		cwd: join(executablePath, ".."), // Run from executable's directory
	});

	// Capture stderr for debugging
	let stderrData = "";
	proc.stderr?.on("data", (data) => {
		stderrData += data.toString();
	});

	// Drain stdout to prevent pipe buffer from filling and blocking
	proc.stdout?.on("data", () => {});

	proc.on("exit", (code) => {
		proc.earlyExit = code !== 0;
		if (code !== 0 && stderrData) {
			console.error("[Test] Process exited with code", code, "stderr:", stderrData);
		}
	});

	return proc;
}

// Helper to kill process and wait
async function killProcess(process) {
	if (process && !process.killed) {
		process.kill("SIGTERM");

		await new Promise((resolve) => {
			process.on("exit", resolve);
			setTimeout(() => {
				if (!process.killed) {
					process.kill("SIGKILL");
				}
				resolve(); // Resolve anyway after timeout
			}, 500);
		});
	}

	// Wait for port to be free (reduced)
	await new Promise((resolve) => setTimeout(resolve, 100));
}

// ======================
// BASIC EXECUTABLE TESTS
// ======================

test(
	"build and run executable - basic functionality",
	async () => {
		const cleanup_paths = [];

		try {
			const testDir = await createTempDir();
			cleanup_paths.push(testDir);

			// Create a simple ServiceWorker
			const serviceWorkerContent = `
self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	
	if (url.pathname === "/") {
		event.respondWith(new Response(\`
			<!DOCTYPE html>
			<html>
				<head><title>Executable Test</title></head>
				<body><h1>Hello from executable build!</h1></body>
			</html>
		\`, {
			headers: { "content-type": "text/html; charset=utf-8" }
		}));
	} else if (url.pathname === "/health") {
		event.respondWith(Response.json({
			status: "ok",
			timestamp: Date.now()
		}));
	}
});
			`;

			const entryPath = await createTempFile(
				testDir,
				"app.js",
				serviceWorkerContent,
			);
			const outDir = join(testDir, "dist");

			// Build executable
			const {buildForProduction} = await import("../src/commands/build.js");

			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node",
			});

			// Verify build output
			const appPath = join(outDir, "server", "index.js");
			const packagePath = join(outDir, "server", "package.json");

			expect(
				await FS.access(appPath)
					.then(() => true)
					.catch(() => false),
			).toBe(true);
			expect(
				await FS.access(packagePath)
					.then(() => true)
					.catch(() => false),
			).toBe(true);

			// Check executable has shebang
			const appContent = await FS.readFile(appPath, "utf8");
			expect(appContent.startsWith("#!/usr/bin/env node")).toBe(true);

			// Make executable
			await FS.chmod(appPath, 0o755);

			// Skip npm install in test environment - dependencies should be bundled

			// Validate the built executable contains expected platform code
			expect(appContent).toContain("ServiceWorkerPool");

			// Validate user code is in server.js
			const serverPath = join(outDir, "server", "server.js");
			const serverContent = await FS.readFile(serverPath, "utf8");
			expect(serverContent).toContain("health");

			// Verify package.json structure
			const packageContent = await FS.readFile(packagePath, "utf8");
			const packageData = JSON.parse(packageContent);
			expect(packageData.type).toBe("module");
			expect(packageData.name).toBe("shovel-executable");
		} finally {
			console.info(
				`[Test] Debug: Built executable in cleanup_paths:`,
				cleanup_paths,
			);
			// await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"executable with environment variables",
	async () => {
		const cleanup_paths = [];
		let serverProcess;

		try {
			const testDir = await createTempDir();
			cleanup_paths.push(testDir);

			const serviceWorkerContent = `
self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	
	if (url.pathname === "/env") {
		event.respondWith(Response.json({
			port: process.env.PORT || "default",
			host: process.env.HOST || "default",
			nodeEnv: process.env.NODE_ENV || "default"
		}));
	} else {
		event.respondWith(new Response("Server is running"));
	}
});
			`;

			const entryPath = await createTempFile(
				testDir,
				"app.js",
				serviceWorkerContent,
			);
			const outDir = join(testDir, "dist");

			const {buildForProduction} = await import("../src/commands/build.js");

			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node",
			});

			const appPath = join(outDir, "server", "index.js");
			await FS.chmod(appPath, 0o755);

			// Dependencies are bundled, no npm install needed

			// Run with custom environment
			const PORT = 18002;
			const HOST = "127.0.0.1";
			serverProcess = runExecutable(appPath, {
				PORT: PORT.toString(),
				HOST,
				NODE_ENV: "test",
			});

			await waitForServer(PORT, HOST);

			// Test environment variables are accessible
			const envResponse = await fetch(`http://${HOST}:${PORT}/env`);
			const envData = await envResponse.json();

			expect(envData.port).toBe(PORT.toString());
			expect(envData.host).toBe(HOST);
			// NODE_ENV is hardcoded to "production" in build-time configuration
			expect(envData.nodeEnv).toBe("production");
		} finally {
			if (serverProcess) {
				await killProcess(serverProcess);
			}
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// ASSET SERVING TESTS
// ======================

test(
	"executable serves static assets",
	async () => {
		const cleanup_paths = [];
		let serverProcess;

		try {
			const testDir = await createTempDir();
			cleanup_paths.push(testDir);

			// Create asset files
			const cssContent = `body { background: #f0f0f0; color: #333; }`;
			const jsContent = `console.log("Asset loaded");`;

			await createTempFile(testDir, "style.css", cssContent);
			await createTempFile(testDir, "client.js", jsContent);

			const serviceWorkerContent = `
import "./style.css" with { assetBase: "assets" };
import "./client.js" with { assetBase: "static" };

// Load asset manifest at startup
let assetManifest = null;
(async () => {
	try {
		const fs = await import('fs/promises');
		const path = await import('path');
		const url = await import('url');
		const executableDir = path.dirname(url.fileURLToPath(import.meta.url));
		const manifestPath = path.join(executableDir, 'asset-manifest.json');
		const manifestContent = await fs.readFile(manifestPath, 'utf8');
		assetManifest = JSON.parse(manifestContent);
	} catch (err) {
		console.log('Failed to load asset manifest:', err.message);
	}
})();

function getAssetUrl(originalPath) {
	if (!assetManifest) return originalPath;
	
	// Find asset by checking if the source ends with the requested path
	for (const [source, asset] of Object.entries(assetManifest.assets)) {
		if (source.endsWith(originalPath.replace('./', ''))) {
			return asset.output;
		}
	}
	return originalPath;
}

self.addEventListener("fetch", async (event) => {
	const url = new URL(event.request.url);
	
	if (url.pathname === "/") {
		event.respondWith(new Response(\`
			<!DOCTYPE html>
			<html>
				<head>
					<title>Assets Test</title>
					<link rel="stylesheet" href="/assets/style.css">
				</head>
				<body>
					<h1>Executable with Assets</h1>
					<script src="/assets/client.js"></script>
				</body>
			</html>
		\`, {
			headers: { "content-type": "text/html; charset=utf-8" }
		}));
	} else if (url.pathname.startsWith("/assets/")) {
		// Serve assets from buckets using asset manifest
		const requestedAsset = url.pathname.slice("/assets/".length);
		const actualAsset = getAssetUrl(requestedAsset);
		
		event.respondWith((async () => {
			try {
				const assetsBucket = await self.buckets.getDirectoryHandle("assets");
				const fileHandle = await assetsBucket.getFileHandle(actualAsset);
				const file = await fileHandle.getFile();
				const content = await file.text();
				
				let contentType = "text/plain";
				if (requestedAsset.endsWith(".css")) {
					contentType = "text/css";
				} else if (requestedAsset.endsWith(".js")) {
					contentType = "application/javascript";
				}
				
				return new Response(content, {
					headers: { "content-type": contentType }
				});
			} catch {
				return new Response("Asset not found", { status: 404 });
			}
		})());
	} else {
		event.respondWith(new Response("Not found", { status: 404 }));
	}
});
			`;

			const entryPath = await createTempFile(
				testDir,
				"app.js",
				serviceWorkerContent,
			);
			const outDir = join(testDir, "dist");

			const {buildForProduction} = await import("../src/commands/build.js");

			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node",
			});

			const appPath = join(outDir, "server", "index.js");
			await FS.chmod(appPath, 0o755);

			// Dependencies are bundled, no npm install needed

			const PORT = 18003;
			serverProcess = runExecutable(appPath, {PORT: PORT.toString()});

			await waitForServer(PORT);

			// Test main page
			const mainResponse = await fetch(`http://localhost:${PORT}/`);
			const mainContent = await mainResponse.text();
			expect(mainContent).toContain("Executable with Assets");

			// Test CSS asset
			const cssResponse = await fetch(
				`http://localhost:${PORT}/assets/style.css`,
			);
			expect(cssResponse.status).toBe(200);
			expect(cssResponse.headers.get("content-type")).toBe("text/css");
			const cssResponseContent = await cssResponse.text();
			expect(cssResponseContent).toContain("background: #f0f0f0");

			// Test JS asset
			const jsResponse = await fetch(
				`http://localhost:${PORT}/assets/client.js`,
			);
			expect(jsResponse.status).toBe(200);
			expect(jsResponse.headers.get("content-type")).toBe(
				"application/javascript",
			);
			const jsResponseContent = await jsResponse.text();
			expect(jsResponseContent).toContain("Asset loaded");
		} finally {
			if (serverProcess) {
				await killProcess(serverProcess);
			}
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// ERROR HANDLING TESTS
// ======================

test(
	"executable error handling and graceful shutdown",
	async () => {
		const cleanup_paths = [];
		let serverProcess;

		try {
			const testDir = await createTempDir();
			cleanup_paths.push(testDir);

			const serviceWorkerContent = `
self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	
	if (url.pathname === "/error") {
		// Intentionally return an error response
		event.respondWith(new Response("Internal Server Error", { status: 500 }));
	} else if (url.pathname === "/") {
		event.respondWith(new Response("Server is running"));
	} else {
		event.respondWith(new Response("Not found", { status: 404 }));
	}
});
			`;

			const entryPath = await createTempFile(
				testDir,
				"app.js",
				serviceWorkerContent,
			);
			const outDir = join(testDir, "dist");

			const {buildForProduction} = await import("../src/commands/build.js");

			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node",
			});

			const appPath = join(outDir, "server", "index.js");
			await FS.chmod(appPath, 0o755);

			// Dependencies are bundled, no npm install needed

			const PORT = 18004;
			serverProcess = runExecutable(appPath, {PORT: PORT.toString()});

			await waitForServer(PORT);

			// Test normal request works
			const normalResponse = await fetch(`http://localhost:${PORT}/`);
			expect(await normalResponse.text()).toBe("Server is running");

			// Test error handling - server should return 500 but stay running
			const errorResponse = await fetch(`http://localhost:${PORT}/error`);
			expect(errorResponse.status).toBe(500);

			// Server should still be responsive after error
			const afterErrorResponse = await fetch(`http://localhost:${PORT}/`);
			expect(await afterErrorResponse.text()).toBe("Server is running");

			// Test graceful shutdown with SIGTERM
			serverProcess.kill("SIGTERM");

			// Process should exit gracefully
			const exitPromise = new Promise((resolve) => {
				serverProcess.on("exit", (code) => resolve(code));
			});

			const exitCode = await Promise.race([
				exitPromise,
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("Process didn't exit")), 5000),
				),
			]);

			expect(exitCode).toBe(0);
			serverProcess = null; // Mark as cleaned up
		} finally {
			if (serverProcess) {
				await killProcess(serverProcess);
			}
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// DEPLOYMENT TESTS
// ======================

test(
	"executable deployment workflow",
	async () => {
		const cleanup_paths = [];

		try {
			const testDir = await createTempDir();
			cleanup_paths.push(testDir);

			const serviceWorkerContent = `
self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	
	event.respondWith(Response.json({
		message: "Deployed successfully",
		url: url.href,
		method: event.request.method,
		timestamp: Date.now()
	}));
});
			`;

			const entryPath = await createTempFile(
				testDir,
				"app.js",
				serviceWorkerContent,
			);
			const outDir = join(testDir, "dist");

			// Build for production
			const {buildForProduction} = await import("../src/commands/build.js");

			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node",
			});

			// Verify deployment artifacts
			const appPath = join(outDir, "server", "index.js");
			const packagePath = join(outDir, "server", "package.json");
			const assetsPath = join(outDir, "assets");

			// Check all required files exist
			expect(
				await FS.access(appPath)
					.then(() => true)
					.catch(() => false),
			).toBe(true);
			expect(
				await FS.access(packagePath)
					.then(() => true)
					.catch(() => false),
			).toBe(true);
			expect(
				await FS.access(assetsPath)
					.then(() => true)
					.catch(() => false),
			).toBe(true);

			// Check package.json is valid
			const packageContent = await FS.readFile(packagePath, "utf8");
			const packageJson = JSON.parse(packageContent);
			expect(typeof packageJson).toBe("object");

			// Check app.js is executable
			const appStat = await FS.stat(appPath);
			const isExecutable = (appStat.mode & 0o111) !== 0; // Check execute bits
			expect(isExecutable).toBe(true);

			// Check assets manifest exists
			const manifestPath = join(outDir, "server", "asset-manifest.json");
			expect(
				await FS.access(manifestPath)
					.then(() => true)
					.catch(() => false),
			).toBe(true);

			const manifestContent = await FS.readFile(manifestPath, "utf8");
			const manifest = JSON.parse(manifestContent);
			expect(typeof manifest).toBe("object");
			expect(typeof manifest.generated).toBe("string");

			// Simulate deployment: copy dist to "production" directory
			const prodDir = join(testDir, "production");
			await FS.cp(outDir, prodDir, {recursive: true});

			// Verify production directory has same structure
			expect(
				await FS.access(join(prodDir, "server", "server.js"))
					.then(() => true)
					.catch(() => false),
			).toBe(true);
			expect(
				await FS.access(join(prodDir, "server", "package.json"))
					.then(() => true)
					.catch(() => false),
			).toBe(true);
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// PERFORMANCE TESTS
// ======================

test(
	"executable startup performance",
	async () => {
		const cleanup_paths = [];
		let serverProcess;

		try {
			const testDir = await createTempDir();
			cleanup_paths.push(testDir);

			const serviceWorkerContent = `
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Performance test"));
});
			`;

			const entryPath = await createTempFile(
				testDir,
				"app.js",
				serviceWorkerContent,
			);
			const outDir = join(testDir, "dist");

			const {buildForProduction} = await import("../src/commands/build.js");

			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node",
			});

			const appPath = join(outDir, "server", "index.js");
			await FS.chmod(appPath, 0o755);

			// Dependencies are bundled, no npm install needed

			// Measure startup time
			const PORT = 18005;
			const startTime = Date.now();

			serverProcess = runExecutable(appPath, {PORT: PORT.toString()});

			await waitForServer(PORT);

			const startupTime = Date.now() - startTime;

			// Startup should be reasonably fast (less than 5 seconds)
			expect(startupTime).toBeLessThan(5000);

			// Test that server is actually working
			const response = await fetch(`http://localhost:${PORT}/test`);
			expect(await response.text()).toBe("Performance test");
		} finally {
			if (serverProcess) {
				await killProcess(serverProcess);
			}
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"executable memory usage",
	async () => {
		const cleanup_paths = [];
		let serverProcess;

		try {
			const testDir = await createTempDir();
			cleanup_paths.push(testDir);

			// Create a ServiceWorker with some complexity
			const serviceWorkerContent = `
const data = Array.from({ length: 1000 }, (_, i) => ({
	id: i,
	name: \`Item \${i}\`,
	timestamp: Date.now()
}));

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	
	if (url.pathname === "/data") {
		event.respondWith(Response.json(data));
	} else {
		event.respondWith(new Response("Memory test"));
	}
});
			`;

			const entryPath = await createTempFile(
				testDir,
				"app.js",
				serviceWorkerContent,
			);
			const outDir = join(testDir, "dist");

			const {buildForProduction} = await import("../src/commands/build.js");

			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node",
			});

			const appPath = join(outDir, "server", "index.js");
			await FS.chmod(appPath, 0o755);

			// Dependencies are bundled, no npm install needed

			const PORT = 18006;
			serverProcess = runExecutable(appPath, {PORT: PORT.toString()});

			await waitForServer(PORT);

			// Make several requests to test memory stability
			for (let i = 0; i < 10; i++) {
				const response = await fetch(`http://localhost:${PORT}/data`);
				const data = await response.json();
				expect(Array.isArray(data)).toBe(true);
				expect(data.length).toBe(1000);
			}

			// Test basic response still works
			const basicResponse = await fetch(`http://localhost:${PORT}/test`);
			expect(await basicResponse.text()).toBe("Memory test");

			// This test mainly ensures the server doesn't crash under load
			// More sophisticated memory testing would require additional tooling
		} finally {
			if (serverProcess) {
				await killProcess(serverProcess);
			}
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);
