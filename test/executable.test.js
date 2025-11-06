import { test, expect } from "bun:test";
import * as FS from "fs/promises";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Directly executable builds integration tests
 * Tests the end-to-end functionality of self-contained executable builds
 */

const TIMEOUT = 30000;

// Helper functions
async function createTempDir(prefix = "executable-test-") {
	const tempPath = join(tmpdir(), `${prefix}${Date.now()}`);
	await FS.mkdir(tempPath, { recursive: true });
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
			await FS.rm(path, { recursive: true, force: true });
		} catch {
			// Already removed
		}
	}
}

// Helper to wait for server to be ready
async function waitForServer(port, timeoutMs = 10000) {
	const startTime = Date.now();

	while (Date.now() - startTime < timeoutMs) {
		try {
			const response = await fetch(`http://localhost:${port}`);
			if (response.ok) {
				return await response.text();
			}
		} catch (err) {
			// Server not ready yet, continue waiting
		}

		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	throw new Error(`Server at port ${port} never became ready within ${timeoutMs}ms`);
}

// Helper to run executable and get process
function runExecutable(executablePath, env = {}) {
	return spawn("node", [executablePath], {
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, ...env },
		cwd: process.cwd()
	});
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
			}, 2000);
		});
	}

	// Wait for port to be free
	await new Promise((resolve) => setTimeout(resolve, 1000));
}

// ======================
// BASIC EXECUTABLE TESTS
// ======================

test(
	"build and run executable - basic functionality",
	async () => {
		const cleanup_paths = [];
		let serverProcess;

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

			const entryPath = await createTempFile(testDir, "app.js", serviceWorkerContent);
			const outDir = join(testDir, "dist");

			// Build executable
			const { buildForProduction } = await import("../src/_build.js");
			
			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node"
			});

			// Verify build output
			const appPath = join(outDir, "app.js");
			const packagePath = join(outDir, "package.json");

			expect(await FS.access(appPath).then(() => true).catch(() => false)).toBe(true);
			expect(await FS.access(packagePath).then(() => true).catch(() => false)).toBe(true);

			// Check executable has shebang
			const appContent = await FS.readFile(appPath, "utf8");
			expect(appContent.startsWith("#!/usr/bin/env node")).toBe(true);

			// Make executable
			await FS.chmod(appPath, 0o755);

			// Install dependencies in dist directory
			const npmInstall = spawn("npm", ["install"], {
				cwd: outDir,
				stdio: ["ignore", "pipe", "pipe"]
			});

			await new Promise((resolve, reject) => {
				npmInstall.on("exit", (code) => {
					if (code === 0) resolve();
					else reject(new Error(`npm install failed with code ${code}`));
				});
			});

			// Run executable
			const PORT = 18001;
			serverProcess = runExecutable(appPath, { PORT: PORT.toString() });

			// Wait for server to start
			const response = await waitForServer(PORT);
			expect(response).toContain("Hello from executable build!");

			// Test API endpoint
			const healthResponse = await fetch(`http://localhost:${PORT}/health`);
			const healthData = await healthResponse.json();
			expect(healthData.status).toBe("ok");
			expect(typeof healthData.timestamp).toBe("number");

		} finally {
			if (serverProcess) {
				await killProcess(serverProcess);
			}
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT
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
	}
});
			`;

			const entryPath = await createTempFile(testDir, "app.js", serviceWorkerContent);
			const outDir = join(testDir, "dist");

			const { buildForProduction } = await import("../src/_build.js");
			
			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node"
			});

			const appPath = join(outDir, "app.js");
			await FS.chmod(appPath, 0o755);

			// Install dependencies
			const npmInstall = spawn("npm", ["install"], { cwd: outDir, stdio: "ignore" });
			await new Promise((resolve) => npmInstall.on("exit", resolve));

			// Run with custom environment
			const PORT = 18002;
			const HOST = "127.0.0.1";
			serverProcess = runExecutable(appPath, { 
				PORT: PORT.toString(), 
				HOST,
				NODE_ENV: "test"
			});

			await waitForServer(PORT);

			// Test environment variables are accessible
			const envResponse = await fetch(`http://localhost:${PORT}/env`);
			const envData = await envResponse.json();
			
			expect(envData.port).toBe(PORT.toString());
			expect(envData.host).toBe(HOST);
			expect(envData.nodeEnv).toBe("test");

		} finally {
			if (serverProcess) {
				await killProcess(serverProcess);
			}
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT
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
import "./style.css" with { assetBase: "/assets/" };
import "./client.js" with { assetBase: "/assets/" };

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
		// Serve assets from buckets
		const assetPath = url.pathname.slice("/assets/".length);
		
		try {
			const assetsBucket = await self.buckets.getDirectoryHandle("assets");
			const fileHandle = await assetsBucket.getFileHandle(assetPath);
			const file = await fileHandle.getFile();
			const content = await file.text();
			
			let contentType = "text/plain";
			if (assetPath.endsWith(".css")) {
				contentType = "text/css";
			} else if (assetPath.endsWith(".js")) {
				contentType = "application/javascript";
			}
			
			event.respondWith(new Response(content, {
				headers: { "content-type": contentType }
			}));
		} catch {
			event.respondWith(new Response("Asset not found", { status: 404 }));
		}
	}
});
			`;

			const entryPath = await createTempFile(testDir, "app.js", serviceWorkerContent);
			const outDir = join(testDir, "dist");

			const { buildForProduction } = await import("../src/_build.js");
			
			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node"
			});

			const appPath = join(outDir, "app.js");
			await FS.chmod(appPath, 0o755);

			// Install dependencies
			const npmInstall = spawn("npm", ["install"], { cwd: outDir, stdio: "ignore" });
			await new Promise((resolve) => npmInstall.on("exit", resolve));

			const PORT = 18003;
			serverProcess = runExecutable(appPath, { PORT: PORT.toString() });

			await waitForServer(PORT);

			// Test main page
			const mainResponse = await fetch(`http://localhost:${PORT}/`);
			const mainContent = await mainResponse.text();
			expect(mainContent).toContain("Executable with Assets");

			// Test CSS asset
			const cssResponse = await fetch(`http://localhost:${PORT}/assets/style.css`);
			expect(cssResponse.status).toBe(200);
			expect(cssResponse.headers.get("content-type")).toBe("text/css");
			const cssResponseContent = await cssResponse.text();
			expect(cssResponseContent).toContain("background: #f0f0f0");

			// Test JS asset
			const jsResponse = await fetch(`http://localhost:${PORT}/assets/client.js`);
			expect(jsResponse.status).toBe(200);
			expect(jsResponse.headers.get("content-type")).toBe("application/javascript");
			const jsResponseContent = await jsResponse.text();
			expect(jsResponseContent).toContain("Asset loaded");

		} finally {
			if (serverProcess) {
				await killProcess(serverProcess);
			}
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT
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
		// Intentionally throw an error
		throw new Error("Test error");
	} else if (url.pathname === "/") {
		event.respondWith(new Response("Server is running"));
	}
});
			`;

			const entryPath = await createTempFile(testDir, "app.js", serviceWorkerContent);
			const outDir = join(testDir, "dist");

			const { buildForProduction } = await import("../src/_build.js");
			
			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node"
			});

			const appPath = join(outDir, "app.js");
			await FS.chmod(appPath, 0o755);

			// Install dependencies
			const npmInstall = spawn("npm", ["install"], { cwd: outDir, stdio: "ignore" });
			await new Promise((resolve) => npmInstall.on("exit", resolve));

			const PORT = 18004;
			serverProcess = runExecutable(appPath, { PORT: PORT.toString() });

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
					setTimeout(() => reject(new Error("Process didn't exit")), 5000)
				)
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
	TIMEOUT
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

			const entryPath = await createTempFile(testDir, "app.js", serviceWorkerContent);
			const outDir = join(testDir, "dist");

			// Build for production
			const { buildForProduction } = await import("../src/_build.js");
			
			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node"
			});

			// Verify deployment artifacts
			const appPath = join(outDir, "app.js");
			const packagePath = join(outDir, "package.json");
			const assetsPath = join(outDir, "assets");

			// Check all required files exist
			expect(await FS.access(appPath).then(() => true).catch(() => false)).toBe(true);
			expect(await FS.access(packagePath).then(() => true).catch(() => false)).toBe(true);
			expect(await FS.access(assetsPath).then(() => true).catch(() => false)).toBe(true);

			// Check package.json is valid
			const packageContent = await FS.readFile(packagePath, "utf8");
			const packageJson = JSON.parse(packageContent);
			expect(typeof packageJson).toBe("object");

			// Check app.js is executable
			const appStat = await FS.stat(appPath);
			const isExecutable = (appStat.mode & 0o111) !== 0; // Check execute bits
			expect(isExecutable).toBe(true);

			// Check assets manifest exists
			const manifestPath = join(assetsPath, "manifest.json");
			expect(await FS.access(manifestPath).then(() => true).catch(() => false)).toBe(true);

			const manifestContent = await FS.readFile(manifestPath, "utf8");
			const manifest = JSON.parse(manifestContent);
			expect(typeof manifest).toBe("object");
			expect(typeof manifest.generated).toBe("string");

			// Simulate deployment: copy dist to "production" directory
			const prodDir = join(testDir, "production");
			await FS.cp(outDir, prodDir, { recursive: true });

			// Verify production directory has same structure
			expect(await FS.access(join(prodDir, "app.js")).then(() => true).catch(() => false)).toBe(true);
			expect(await FS.access(join(prodDir, "package.json")).then(() => true).catch(() => false)).toBe(true);

		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT
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

			const entryPath = await createTempFile(testDir, "app.js", serviceWorkerContent);
			const outDir = join(testDir, "dist");

			const { buildForProduction } = await import("../src/_build.js");
			
			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node"
			});

			const appPath = join(outDir, "app.js");
			await FS.chmod(appPath, 0o755);

			// Install dependencies
			const npmInstall = spawn("npm", ["install"], { cwd: outDir, stdio: "ignore" });
			await new Promise((resolve) => npmInstall.on("exit", resolve));

			// Measure startup time
			const PORT = 18005;
			const startTime = Date.now();
			
			serverProcess = runExecutable(appPath, { PORT: PORT.toString() });

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
	TIMEOUT
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

			const entryPath = await createTempFile(testDir, "app.js", serviceWorkerContent);
			const outDir = join(testDir, "dist");

			const { buildForProduction } = await import("../src/_build.js");
			
			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node"
			});

			const appPath = join(outDir, "app.js");
			await FS.chmod(appPath, 0o755);

			// Install dependencies
			const npmInstall = spawn("npm", ["install"], { cwd: outDir, stdio: "ignore" });
			await new Promise((resolve) => npmInstall.on("exit", resolve));

			const PORT = 18006;
			serverProcess = runExecutable(appPath, { PORT: PORT.toString() });

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
	TIMEOUT
);