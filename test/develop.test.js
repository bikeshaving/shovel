/* eslint-disable no-restricted-properties -- Tests need process.cwd/env */
import * as FS from "fs/promises";
import {spawn} from "child_process";
import {test, expect} from "bun:test";
import {join, dirname as _dirname} from "path";
import {tmpdir} from "os";
import {mkdtemp} from "fs/promises";
import {configure, getConsoleSink, getLogger} from "@logtape/logtape";
import {AsyncContext} from "@b9g/async-context";

// Configure LogTape for tests (warnings only by default)
// Debug logging is controlled per-test via shovel.json in temp directories
await configure({
	reset: true,
	contextLocalStorage: new AsyncContext.Variable(),
	sinks: {console: getConsoleSink()},
	loggers: [
		{category: ["logtape", "meta"], sinks: []},
		{category: ["shovel"], level: "warning", sinks: ["console"]},
		{category: ["test"], level: "debug", sinks: ["console"]},
	],
});

const logger = getLogger(["test", "develop"]);

/**
 * Development server hot reload tests
 * Tests our Worker-based architecture for dependency invalidation
 * Includes both basic functionality and advanced stress testing
 */

const TIMEOUT = 20000; // 20 second timeout for complex tests (Linux file watching can be slow)

// Helper to create a temporary directory with node_modules and shovel.json
async function createTempDir() {
	const tempDir = await mkdtemp(join(tmpdir(), "shovel-test-"));

	// Symlink node_modules so fixtures can import dependencies
	const nodeModulesSource = join(process.cwd(), "node_modules");
	const nodeModulesLink = join(tempDir, "node_modules");
	await FS.symlink(nodeModulesSource, nodeModulesLink, "dir");

	// Create shovel.json with logging config (warnings only for tests)
	await FS.writeFile(
		join(tempDir, "shovel.json"),
		JSON.stringify(
			{
				logging: {
					loggers: [{category: "shovel", level: "warning", sinks: ["console"]}],
				},
			},
			null,
			2,
		),
	);

	return {
		dir: tempDir,
		async cleanup() {
			await FS.rm(tempDir, {recursive: true, force: true});
		},
	};
}

// Helper to create temporary fixture copy
async function createTempFixture(fixtureName) {
	const temp = await createTempDir();
	const tempFile = join(temp.dir, fixtureName);
	const sourceFile = join("./test/fixtures", fixtureName);

	// Use readFile + writeFile instead of copyFile for more reliable
	// inotify event generation on Linux
	const content = await FS.readFile(sourceFile, "utf-8");
	await FS.writeFile(tempFile, content);

	return {
		path: tempFile,
		dir: temp.dir,
		async copyFrom(sourceFixture) {
			const sourcePath = join("./test/fixtures", sourceFixture);
			// Use readFile + writeFile instead of copyFile for more reliable
			// inotify event generation on Linux
			const content = await FS.readFile(sourcePath, "utf-8");
			await FS.writeFile(tempFile, content);
		},
		async addDependency(dependencyFixture) {
			const depFile = join(this.dir, dependencyFixture);
			const sourceFile = join("./test/fixtures", dependencyFixture);
			// Use readFile + writeFile instead of copyFile for more reliable
			// inotify event generation on Linux
			const content = await FS.readFile(sourceFile, "utf-8");
			await FS.writeFile(depFile, content);
			return depFile;
		},
		async copyDependencyFrom(dependencyFixture, sourceFixture) {
			const depFile = join(this.dir, dependencyFixture);
			const sourceFile = join("./test/fixtures", sourceFixture);
			// Use readFile + writeFile instead of copyFile for more reliable
			// inotify event generation on Linux
			const content = await FS.readFile(sourceFile, "utf-8");
			await FS.writeFile(depFile, content);
		},
		cleanup: temp.cleanup,
	};
}

// Helper to start a development server
function startDevServer(fixture, port, extraArgs = []) {
	// Always run from the fixture directory to avoid polluting shovel repo's dist/
	const fixtureDir = _dirname(fixture);
	const fixtureFile = fixture.split("/").pop();
	const cliPath = join(process.cwd(), "./dist/bin/cli.js");

	const args = [
		cliPath,
		"develop",
		fixtureFile,
		"--port",
		port.toString(),
		...extraArgs,
	];

	const serverProcess = spawn("node", args, {
		stdio: ["ignore", "pipe", "pipe"],
		cwd: fixtureDir,
		env: {
			...process.env,
			NODE_ENV: "development",
			NODE_PATH: join(process.cwd(), "node_modules"),
		},
	});

	// Capture stderr to detect CLI failures early
	let stderrOutput = "";
	let _stdoutOutput = "";

	serverProcess.stdout.on("data", (data) => {
		_stdoutOutput += data.toString();
	});

	serverProcess.stderr.on("data", (data) => {
		stderrOutput += data.toString();
	});

	// If process exits early, it's likely an error
	serverProcess.on("exit", (code) => {
		if (code !== 0 && code !== null) {
			serverProcess.earlyExit = {code, stderr: stderrOutput};
		}
	});

	return serverProcess;
}

// Helper to check if TCP port is accepting connections (faster than HTTP)
async function isPortOpen(port) {
	return new Promise((resolve) => {
		const {createConnection} = require("net");
		const socket = createConnection({port, host: "localhost", timeout: 50});

		socket.on("connect", () => {
			socket.destroy();
			resolve(true);
		});

		socket.on("error", () => {
			resolve(false);
		});

		socket.on("timeout", () => {
			socket.destroy();
			resolve(false);
		});
	});
}

// Helper to wait for server to be ready and return response
async function waitForServer(port, serverProcess, timeoutMs = 8000) {
	const startTime = Date.now();

	// First, wait for port to be open (much faster than HTTP)
	while (Date.now() - startTime < timeoutMs / 2) {
		if (serverProcess?.earlyExit) {
			throw new Error(
				`CLI process exited early with code ${serverProcess.earlyExit.code}:\n${serverProcess.earlyExit.stderr}`,
			);
		}

		if (await isPortOpen(port)) {
			break;
		}

		await new Promise((resolve) => setTimeout(resolve, 25));
	}

	// Then verify HTTP responses work
	while (Date.now() - startTime < timeoutMs) {
		if (serverProcess?.earlyExit) {
			throw new Error(
				`CLI process exited early with code ${serverProcess.earlyExit.code}:\n${serverProcess.earlyExit.stderr}`,
			);
		}

		try {
			const response = await fetch(`http://localhost:${port}`);
			if (response.ok || response.status < 500) {
				return await response.text();
			}
			// 500 errors - server not ready yet, continue waiting
		} catch (err) {
			// Server not ready yet, continue waiting
			logger.debug`Waiting for server: ${err.message}`;
		}

		await new Promise((resolve) => setTimeout(resolve, 25));
	}

	throw new Error(
		`Server at port ${port} never became ready within ${timeoutMs}ms`,
	);
}

// Helper to fetch from server with retry
async function fetchWithRetry(port, retries = 20, delay = 50) {
	for (let i = 0; i < retries; i++) {
		try {
			const response = await fetch(`http://localhost:${port}`);
			return await response.text();
		} catch (err) {
			if (i === retries - 1) throw err;
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
}

// Helper to wait for response content to change
async function waitForContentChange(
	port,
	expectedContent,
	{timeoutMs = 10000, contains = false} = {},
) {
	const startTime = Date.now();
	while (Date.now() - startTime < timeoutMs) {
		try {
			const response = await fetch(`http://localhost:${port}`);
			const text = await response.text();
			const matches = contains
				? text.includes(expectedContent)
				: text === expectedContent;
			if (matches) {
				return text;
			}
		} catch (err) {
			// Server not ready, continue waiting
			logger.debug`Waiting for content: ${err.message}`;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(
		`Content did not change to expected value within ${timeoutMs}ms`,
	);
}

// Helper to kill process and wait for port to be free
async function killServer(process, port) {
	if (process && process.exitCode === null) {
		process.kill("SIGTERM");

		// Wait for process to exit
		await new Promise((resolve) => {
			const cleanup = () => {
				process.removeListener("exit", cleanup);
				process.removeListener("close", cleanup);
				resolve();
			};

			process.on("exit", cleanup);
			process.on("close", cleanup);

			// Force kill if it doesn't exit gracefully
			setTimeout(() => {
				if (process.exitCode === null) {
					process.kill("SIGKILL");
				}
				resolve(); // Resolve anyway after force kill
			}, 1000);
		});
	}

	// Wait for port to actually be free
	if (port) {
		for (let i = 0; i < 20; i++) {
			if (!(await isPortOpen(port))) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
}

// =======================
// BASIC FUNCTIONALITY TESTS
// =======================

test(
	"basic server startup and response",
	async () => {
		const PORT = 13310;
		let serverProcess;
		let tempFixture;

		try {
			// Create temporary fixture copy to avoid polluting repo dist/
			tempFixture = await createTempFixture("server-minimal.ts");

			// Start development server with minimal test fixture (no external dependencies)
			serverProcess = startDevServer(tempFixture.path, PORT);

			// Wait for server to be ready
			const response = await waitForServer(PORT, serverProcess);

			// Verify server responds correctly (simple hello fixture)
			expect(response).toContain("<marquee>Hello world</marquee>");
		} finally {
			await killServer(serverProcess, PORT);
			if (tempFixture) {
				await tempFixture.cleanup();
			}
		}
	},
	TIMEOUT,
);

test(
	"hot reload on root file change",
	async () => {
		const PORT = 13311;
		let serverProcess;
		let tempFixture;

		try {
			// Create temporary fixture copy
			tempFixture = await createTempFixture("server-hello.ts");

			// Start development server with temporary fixture
			serverProcess = startDevServer(tempFixture.path, PORT);

			// Wait for initial response
			const initialResponse = await waitForServer(PORT, serverProcess);
			expect(initialResponse).toBe("<marquee>Hello world</marquee>");

			// Modify the temporary file (simulate file change)
			await tempFixture.copyFrom("server-goodbye.ts");

			// Wait for hot reload and verify change
			await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for file change detection

			const updatedResponse = await fetchWithRetry(PORT);
			expect(updatedResponse).toBe("<marquee>Goodbye world</marquee>");
		} finally {
			await killServer(serverProcess, PORT);
			if (tempFixture) {
				await tempFixture.cleanup();
			}
		}
	},
	TIMEOUT,
);

test(
	"hot reload on dependency change",
	async () => {
		const PORT = 13312;
		let serverProcess;
		let tempFixture;

		try {
			// Create temporary fixture copy with its dependency
			tempFixture = await createTempFixture("server-dependent.ts");
			await tempFixture.addDependency("server-dependency-hello.ts");

			// Start development server with temporary fixture that has dependencies
			serverProcess = startDevServer(tempFixture.path, PORT);

			// Wait for initial response
			const initialResponse = await waitForServer(PORT, serverProcess);
			expect(initialResponse).toBe(
				"<marquee>Hello from dependency-hello.ts</marquee>",
			);

			// Give esbuild's watcher time to fully initialize after the first build
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Modify the dependency file (simulate dependency change)
			await tempFixture.copyDependencyFrom(
				"server-dependency-hello.ts",
				"server-dependency-goodbye.ts",
			);

			// Wait for hot reload and verify dependency change propagated
			const updatedResponse = await waitForContentChange(
				PORT,
				"<marquee>Goodbye from dependency-hello.ts</marquee>",
			);
			expect(updatedResponse).toBe(
				"<marquee>Goodbye from dependency-hello.ts</marquee>",
			);
		} finally {
			await killServer(serverProcess, PORT);
			if (tempFixture) {
				await tempFixture.cleanup();
			}
		}
	},
	TIMEOUT,
);

test(
	"hot reload with dynamic imports",
	async () => {
		const PORT = 13313;
		let serverProcess;
		let tempFixture;

		try {
			// Create temporary fixture copies
			tempFixture = await createTempFixture("server-dynamic-dependent.ts");
			await tempFixture.addDependency("server-dependency-hello.ts");

			// Start development server with file that uses dynamic imports
			serverProcess = startDevServer(tempFixture.path, PORT);

			// Wait for initial response
			const initialResponse = await waitForServer(PORT, serverProcess);
			expect(initialResponse).toBe(
				'<marquee behavior="alternate">Hello from dependency-hello.ts</marquee>',
			);

			// Give esbuild's watcher time to fully initialize after the first build
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Modify the dependency file
			await tempFixture.copyDependencyFrom(
				"server-dependency-hello.ts",
				"server-dependency-goodbye.ts",
			);

			// Wait for hot reload and verify dynamic import change propagated
			const updatedResponse = await waitForContentChange(
				PORT,
				'<marquee behavior="alternate">Goodbye from dependency-hello.ts</marquee>',
			);
			expect(updatedResponse).toBe(
				'<marquee behavior="alternate">Goodbye from dependency-hello.ts</marquee>',
			);
		} finally {
			await killServer(serverProcess, PORT);
			if (tempFixture) {
				await tempFixture.cleanup();
			}
		}
	},
	TIMEOUT,
);

test(
	"worker coordination - multiple requests during reload",
	async () => {
		const PORT = 13314;
		let serverProcess;
		let tempFixture;

		try {
			// Create temporary fixture copy
			tempFixture = await createTempFixture("server-hello.ts");

			// Start development server with temporary fixture
			serverProcess = startDevServer(tempFixture.path, PORT);

			// Wait for initial response
			const initialResponse = await waitForServer(PORT, serverProcess);
			expect(initialResponse).toBe("<marquee>Hello world</marquee>");

			// Modify the temporary file
			await tempFixture.copyFrom("server-goodbye.ts");

			// Make multiple concurrent requests during reload
			// Use a longer initial wait to ensure the file change is detected
			await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for file change detection

			const concurrentRequests = Array.from({length: 10}, () =>
				fetchWithRetry(PORT, 5, 100),
			);

			const responses = await Promise.all(concurrentRequests);

			// All responses should be consistent (either old or new, but not mixed)
			const uniqueResponses = [...new Set(responses)];
			expect(uniqueResponses.length).toBeLessThanOrEqual(2); // Should be either 1 or 2 unique responses

			// Wait for the reload to complete and verify the updated version
			const finalResponse = await waitForContentChange(
				PORT,
				"<marquee>Goodbye world</marquee>",
				3000,
			);
			expect(finalResponse).toBe("<marquee>Goodbye world</marquee>");
		} finally {
			await killServer(serverProcess, PORT);
			if (tempFixture) {
				await tempFixture.cleanup();
			}
		}
	},
	TIMEOUT,
);

test(
	"error handling - malformed file",
	async () => {
		const PORT = 13315;
		let serverProcess;
		let tempFixture;

		try {
			// Create temporary fixture copy
			tempFixture = await createTempFixture("server-hello.ts");

			// Start development server with temporary fixture
			serverProcess = startDevServer(tempFixture.path, PORT);

			// Wait for initial response
			const initialResponse = await waitForServer(PORT, serverProcess);
			expect(initialResponse).toBe("<marquee>Hello world</marquee>");

			// Write malformed TypeScript to temporary file
			await FS.writeFile(tempFixture.path, "this is not valid typescript!!!");

			// Wait for attempted reload
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Server should still be running and serving something (error page or last good version)
			const response = await fetchWithRetry(PORT);
			expect(typeof response).toBe("string");
			expect(response.length).toBeGreaterThan(0);
		} finally {
			await killServer(serverProcess, PORT);
			if (tempFixture) {
				await tempFixture.cleanup();
			}
		}
	},
	TIMEOUT,
);

// =======================
// ADVANCED STRESS TESTS
// =======================

test(
	"deep dependency chain hot reload",
	async () => {
		const PORT = 13316;
		let serverProcess;
		let tempDir;

		try {
			// Create isolated temp directory
			tempDir = await createTempDir();

			// Create temporary test files for deep chain
			const testFileA = join(tempDir.dir, "chain-a.ts");
			const testFileB = join(tempDir.dir, "chain-b.ts");
			const testFileMain = join(tempDir.dir, "chain-main.ts");

			// File A (deepest dependency)
			const contentA = `export const value = "A-original";`;
			const modifiedA = `export const value = "A-modified";`;

			// File B (middle dependency, imports A)
			const contentB = `
import {value as aValue} from "./chain-a.js";
export const value = \`B-\${aValue}\`;
			`;

			// Main file (imports B, which imports A)
			const contentMain = `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
import {value} from "./chain-b.js";

self.addEventListener("fetch", (event) => {
	const html = renderer.render(jsx\`<div>\${value}</div>\`);
	event.respondWith(new Response(html, {
		headers: {"content-type": "text/html; charset=UTF-8"},
	}));
});
			`;

			// Create test files
			await FS.writeFile(testFileA, contentA);
			await FS.writeFile(testFileB, contentB);
			await FS.writeFile(testFileMain, contentMain);

			// Start development server
			serverProcess = startDevServer(testFileMain, PORT);

			// Wait for initial response
			const initialResponse = await waitForServer(PORT, serverProcess);
			expect(initialResponse).toBe("<div>B-A-original</div>");

			// Modify the deepest dependency (A)
			await FS.writeFile(testFileA, modifiedA);

			// Wait for cascade reload
			const updatedResponse = await waitForContentChange(
				PORT,
				"<div>B-A-modified</div>",
			);
			expect(updatedResponse).toBe("<div>B-A-modified</div>");
		} finally {
			await killServer(serverProcess, PORT);
			if (tempDir) await tempDir.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"concurrent file modifications",
	async () => {
		const PORT = 13317;
		let serverProcess;
		let tempDir;

		try {
			// Create isolated temp directory
			tempDir = await createTempDir();

			// Create multiple temporary test files
			const testFiles = Array.from({length: 5}, (_, i) => ({
				path: join(tempDir.dir, `dep-${i}.ts`),
				content: `export const value${i} = "original-${i}";`,
				modified: `export const value${i} = "modified-${i}";`,
			}));

			const mainFile = join(tempDir.dir, "main.ts");
			const mainContent = `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
${testFiles.map((_, i) => `import {value${i}} from "./dep-${i}.js";`).join("\n")}

self.addEventListener("fetch", (event) => {
	const allValues = [${testFiles.map((_, i) => `value${i}`).join(", ")}];
	const html = renderer.render(jsx\`<div>Values: \${allValues.join(", ")}</div>\`);
	event.respondWith(new Response(html, {
		headers: {"content-type": "text/html; charset=UTF-8"},
	}));
});
			`;

			// Create all test files
			for (const file of testFiles) {
				await FS.writeFile(file.path, file.content);
			}
			await FS.writeFile(mainFile, mainContent);

			// Start development server
			serverProcess = startDevServer(mainFile, PORT);

			// Wait for initial response
			const initialResponse = await waitForServer(PORT, serverProcess);
			expect(initialResponse).toContain("Values: original-0, original-1");

			// Give esbuild's watcher time to fully initialize after the first build
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Modify all files concurrently
			const modifyPromises = testFiles.map((file) =>
				FS.writeFile(file.path, file.modified),
			);
			await Promise.all(modifyPromises);

			// Wait for reload
			const updatedResponse = await waitForContentChange(
				PORT,
				"Values: modified-0, modified-1",
				{contains: true},
			);
			expect(updatedResponse).toContain("Values: modified-0, modified-1");
		} finally {
			await killServer(serverProcess, PORT);
			if (tempDir) await tempDir.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"high worker count stress test",
	async () => {
		const PORT = 13318;
		let serverProcess;
		let tempFixture;

		try {
			// Create temporary fixture copy to avoid polluting repo
			tempFixture = await createTempFixture("server-hello.ts");

			// Start development server with 8 workers
			serverProcess = startDevServer(tempFixture.path, PORT, [
				"--workers",
				"8",
			]);

			// Wait for server to be ready
			const initialResponse = await waitForServer(PORT, serverProcess);
			expect(initialResponse).toBe("<marquee>Hello world</marquee>");

			// Make 50 concurrent requests
			const concurrentRequests = Array.from({length: 50}, () =>
				fetchWithRetry(PORT),
			);

			const responses = await Promise.all(concurrentRequests);

			// All responses should be identical
			const uniqueResponses = [...new Set(responses)];
			expect(uniqueResponses.length).toBe(1);
			expect(uniqueResponses[0]).toBe("<marquee>Hello world</marquee>");
		} finally {
			await killServer(serverProcess, PORT);
			if (tempFixture) {
				await tempFixture.cleanup();
			}
		}
	},
	TIMEOUT,
);

test(
	"file deletion and recreation",
	async () => {
		const PORT = 13319;
		let serverProcess;
		let tempDir;

		const originalContent = `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

self.addEventListener("fetch", (event) => {
	const html = renderer.render(jsx\`<div>Original</div>\`);
	event.respondWith(new Response(html, {
		headers: {"content-type": "text/html; charset=UTF-8"},
	}));
});
		`;

		const recreatedContent = `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

self.addEventListener("fetch", (event) => {
	const html = renderer.render(jsx\`<div>Recreated</div>\`);
	event.respondWith(new Response(html, {
		headers: {"content-type": "text/html; charset=UTF-8"},
	}));
});
		`;

		try {
			// Create isolated temp directory
			tempDir = await createTempDir();
			const testFile = join(tempDir.dir, "app.ts");

			await FS.writeFile(testFile, originalContent);

			// Start development server
			serverProcess = startDevServer(testFile, PORT);

			// Wait for initial response
			const initialResponse = await waitForServer(PORT, serverProcess);
			expect(initialResponse).toBe("<div>Original</div>");

			// Give esbuild's watcher time to fully initialize after the first build
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Delete the file
			await FS.unlink(testFile);

			// Wait a bit
			await new Promise((resolve) => setTimeout(resolve, 2000));

			// Recreate the file with different content
			await FS.writeFile(testFile, recreatedContent);

			// Wait for reload
			const finalResponse = await waitForContentChange(
				PORT,
				"<div>Recreated</div>",
			);
			expect(finalResponse).toBe("<div>Recreated</div>");
		} finally {
			await killServer(serverProcess, PORT);
			if (tempDir) await tempDir.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"syntax error recovery",
	async () => {
		const PORT = 13320;
		let serverProcess;
		let tempDir;

		const validContent = `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

self.addEventListener("fetch", (event) => {
	const html = renderer.render(jsx\`<div>Valid</div>\`);
	event.respondWith(new Response(html, {
		headers: {"content-type": "text/html; charset=UTF-8"},
	}));
});
		`;
		const invalidContent = "this is invalid typescript !!!";
		const fixedContent = `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

self.addEventListener("fetch", (event) => {
	const html = renderer.render(jsx\`<div>Fixed</div>\`);
	event.respondWith(new Response(html, {
		headers: {"content-type": "text/html; charset=UTF-8"},
	}));
});
		`;

		try {
			// Create isolated temp directory
			tempDir = await createTempDir();
			const testFile = join(tempDir.dir, "app.ts");

			await FS.writeFile(testFile, validContent);

			// Start development server
			serverProcess = startDevServer(testFile, PORT);

			// Wait for initial response
			const initialResponse = await waitForServer(PORT, serverProcess);
			expect(initialResponse).toBe("<div>Valid</div>");

			// Give esbuild's watcher time to fully initialize after the first build
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Write syntax error
			await FS.writeFile(testFile, invalidContent);

			// Wait for error processing
			await new Promise((resolve) => setTimeout(resolve, 2000));

			// Server should still respond (error page or last good version)
			const errorResponse = await fetchWithRetry(PORT);
			expect(typeof errorResponse).toBe("string");

			// Fix the syntax error
			await FS.writeFile(testFile, fixedContent);

			// Wait for recovery
			const recoveredResponse = await waitForContentChange(
				PORT,
				"<div>Fixed</div>",
			);
			expect(recoveredResponse).toBe("<div>Fixed</div>");
		} finally {
			await killServer(serverProcess, PORT);
			if (tempDir) await tempDir.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"large file handling",
	async () => {
		const PORT = 13321;
		let serverProcess;
		let tempDir;

		// Generate a large file with many variables (but still valid TypeScript)
		const generateLargeContent = (variableCount) => {
			const variables = Array.from(
				{length: variableCount},
				(_, i) => `const var${i} = "value${i}";`,
			).join("\n");

			return `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

${variables}

const allVars = [${Array.from({length: variableCount}, (_, i) => `var${i}`).join(", ")}];

self.addEventListener("fetch", (event) => {
	const html = renderer.render(jsx\`<div>Variables: \${allVars.length}</div>\`);
	event.respondWith(new Response(html, {
		headers: {"content-type": "text/html; charset=UTF-8"},
	}));
});
			`;
		};

		const largeContent = generateLargeContent(50); // 50 variables

		try {
			// Create isolated temp directory
			tempDir = await createTempDir();
			const largeFile = join(tempDir.dir, "app.ts");

			await FS.writeFile(largeFile, largeContent);

			// Start development server
			serverProcess = startDevServer(largeFile, PORT);

			// Wait for initial response
			const response = await waitForServer(PORT, serverProcess);
			expect(response).toBe("<div>Variables: 50</div>");

			// Give esbuild's watcher time to fully initialize after the first build
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Modify the large file
			const modifiedContent = largeContent.replace(
				"Variables: ${allVars.length}",
				"Variables: Modified",
			);
			await FS.writeFile(largeFile, modifiedContent);

			const updatedResponse = await waitForContentChange(
				PORT,
				"<div>Variables: Modified</div>",
			);
			expect(updatedResponse).toBe("<div>Variables: Modified</div>");
		} finally {
			await killServer(serverProcess, PORT);
			if (tempDir) await tempDir.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"cache coordination during rapid rebuilds",
	async () => {
		const PORT = 13322;
		let serverProcess;
		let tempDir;

		const cacheContent = (timestamp) => `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

self.addEventListener("fetch", (event) => {
	const html = renderer.render(jsx\`<div>Cached: \${${timestamp}}</div>\`);
	event.respondWith(new Response(html, {
		headers: {"content-type": "text/html; charset=UTF-8"},
	}));
});
		`;

		try {
			// Create isolated temp directory
			tempDir = await createTempDir();
			const cacheFile = join(tempDir.dir, "app.ts");

			await FS.writeFile(cacheFile, cacheContent("Date.now()"));

			// Start development server
			serverProcess = startDevServer(cacheFile, PORT);

			// Wait for initial response
			await waitForServer(PORT, serverProcess);

			// Perform rapid modifications
			const rapidModifications = Array.from({length: 10}, (_, i) =>
				FS.writeFile(cacheFile, cacheContent(`"rapid-${i}"`)).then(
					() => new Promise((resolve) => setTimeout(resolve, 20)),
				),
			);

			// Execute all modifications
			const results = await Promise.allSettled(rapidModifications);

			// Wait for final stabilization
			await new Promise((resolve) => setTimeout(resolve, 800));

			// Server should still be responsive
			const finalResponse = await fetchWithRetry(PORT);
			expect(typeof finalResponse).toBe("string");
			expect(finalResponse.length).toBeGreaterThan(0);

			// Most operations should succeed
			const successful = results.filter(
				(result) => result.status === "fulfilled",
			);
			expect(successful.length).toBeGreaterThan(5);

			// Verify operations completed successfully (writeFile + setTimeout returns undefined)
			successful.forEach((result) => {
				expect(result.value).toBe(undefined);
			});
		} finally {
			await killServer(serverProcess, PORT);
			if (tempDir) await tempDir.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"different file extensions",
	async () => {
		const PORT = 13323;
		let serverProcess;
		let tempDir;

		const jsContent = `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

self.addEventListener("fetch", (event) => {
	const html = renderer.render(jsx\`<div>JavaScript file!</div>\`);
	event.respondWith(new Response(html, {
		headers: {"content-type": "text/html; charset=UTF-8"},
	}));
});
		`;

		const modifiedJsContent = `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

self.addEventListener("fetch", (event) => {
	const html = renderer.render(jsx\`<div>JavaScript modified!</div>\`);
	event.respondWith(new Response(html, {
		headers: {"content-type": "text/html; charset=UTF-8"},
	}));
});
		`;

		try {
			// Create isolated temp directory
			tempDir = await createTempDir();
			const jsFile = join(tempDir.dir, "app.js");

			await FS.writeFile(jsFile, jsContent);

			// Start development server with JS file
			serverProcess = startDevServer(jsFile, PORT);

			// Wait for initial response
			const initialResponse = await waitForServer(PORT, serverProcess);
			expect(initialResponse).toBe("<div>JavaScript file!</div>");

			// Give esbuild's watcher time to fully initialize after the first build
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Modify the JS file
			await FS.writeFile(jsFile, modifiedJsContent);

			// Wait for reload
			const updatedResponse = await waitForContentChange(
				PORT,
				"<div>JavaScript modified!</div>",
			);
			expect(updatedResponse).toBe("<div>JavaScript modified!</div>");
		} finally {
			await killServer(serverProcess, PORT);
			if (tempDir) await tempDir.cleanup();
		}
	},
	TIMEOUT,
);

// =======================
// MONOREPO PATH RESOLUTION TESTS
// =======================

test(
	"monorepo path resolution - cwd differs from workspace root",
	async () => {
		const PORT = 13324;
		let serverProcess;

		// Create a monorepo structure:
		// /tmp/monorepo-test-xxx/
		//   package.json (with workspaces: ["packages/*"])
		//   node_modules/ -> symlink to real node_modules
		//   packages/
		//     my-app/
		//       app.ts (entry point)
		//       dist/ (output will go here)
		const monorepoRoot = await mkdtemp(join(tmpdir(), "monorepo-test-"));
		const packagesDir = join(monorepoRoot, "packages");
		const appDir = join(packagesDir, "my-app");

		try {
			// Create directory structure
			await FS.mkdir(appDir, {recursive: true});

			// Create workspace package.json at monorepo root
			await FS.writeFile(
				join(monorepoRoot, "package.json"),
				JSON.stringify(
					{
						name: "test-monorepo",
						private: true,
						workspaces: ["packages/*"],
					},
					null,
					2,
				),
			);

			// Create package.json for the app (each package in a monorepo has its own)
			await FS.writeFile(
				join(appDir, "package.json"),
				JSON.stringify(
					{
						name: "my-app",
						private: true,
					},
					null,
					2,
				),
			);

			// Create node_modules symlink at monorepo root
			const nodeModulesSource = join(process.cwd(), "node_modules");
			await FS.symlink(
				nodeModulesSource,
				join(monorepoRoot, "node_modules"),
				"dir",
			);

			// Create the app entry point
			const entryContent = `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

self.addEventListener("fetch", (event) => {
	const html = renderer.render(jsx\`<div>Monorepo app works!</div>\`);
	event.respondWith(new Response(html, {
		headers: {"content-type": "text/html; charset=UTF-8"},
	}));
});
			`;
			const entryPath = join(appDir, "app.ts");
			await FS.writeFile(entryPath, entryContent);

			// Start dev server with cwd set to nested app directory (not monorepo root)
			// This is the key scenario that triggers the path duplication bug
			const cliPath = join(process.cwd(), "./dist/bin/cli.js");
			serverProcess = spawn(
				"node",
				[cliPath, "develop", "app.ts", "--port", PORT.toString()],
				{
					stdio: ["ignore", "pipe", "pipe"],
					cwd: appDir, // Running from packages/my-app, not monorepo root
					env: {
						...process.env,
						NODE_ENV: "development",
					},
				},
			);

			let stderrOutput = "";
			serverProcess.stderr.on("data", (data) => {
				stderrOutput += data.toString();
			});

			serverProcess.on("exit", (code) => {
				if (code !== 0 && code !== null) {
					serverProcess.earlyExit = {code, stderr: stderrOutput};
				}
			});

			// Wait for server to be ready
			const response = await waitForServer(PORT, serverProcess);
			expect(response).toBe("<div>Monorepo app works!</div>");

			// Verify no path duplication error occurred
			expect(stderrOutput).not.toContain("Cannot find module");
			expect(stderrOutput).not.toContain("my-app/my-app"); // The doubled path bug
		} finally {
			await killServer(serverProcess, PORT);
			// Clean up monorepo directory
			await FS.rm(monorepoRoot, {recursive: true, force: true});
		}
	},
	TIMEOUT,
);

// =======================
// HOT RELOAD TESTS
// =======================

import {Watcher} from "../src/utils/watcher.ts";
import * as Platform from "@b9g/platform";
import {existsSync} from "fs";

test(
	"watcher onBuild receives valid new bundle path on rebuild",
	async () => {
		const fixtureDir = await mkdtemp(join(tmpdir(), "watcher-rebuild-test-"));

		try {
			// Create package.json
			await FS.writeFile(
				join(fixtureDir, "package.json"),
				JSON.stringify({name: "test-app", private: true}),
			);

			// Symlink node_modules
			await FS.symlink(
				join(process.cwd(), "node_modules"),
				join(fixtureDir, "node_modules"),
				"dir",
			);

			// Create initial app
			const appFile = join(fixtureDir, "app.ts");
			await FS.writeFile(
				appFile,
				`self.addEventListener("fetch", () => new Response("v1"));`,
			);

			let onBuildCalled = false;
			let receivedEntrypoint = null;
			let initialEntrypoint = null;

			// Change to test directory
			const originalCwd = process.cwd();
			process.chdir(fixtureDir);

			// Create platform instance for watcher
			const platform = await Platform.createPlatform("bun");
			const platformESBuildConfig = platform.getESBuildConfig();

			const watcher = new Watcher({
				entrypoint: "app.ts",
				outDir: "dist",
				platform,
				platformESBuildConfig,
				onBuild: async (success, newEntrypoint) => {
					onBuildCalled = true;
					receivedEntrypoint = newEntrypoint;
					// KEY ASSERTIONS:
					// 1. Build should succeed
					expect(success).toBe(true);
					// 2. New entrypoint should be a valid, existing file
					expect(existsSync(newEntrypoint)).toBe(true);
					// 3. Unified build uses stable filename - hot reload terminates workers
					expect(newEntrypoint).toBe(initialEntrypoint);
					// 4. New entrypoint should end with .js
					expect(newEntrypoint).toMatch(/\.js$/);
				},
			});

			try {
				// Initial build
				const {success, entrypoint} = await watcher.start();
				expect(success).toBe(true);
				initialEntrypoint = entrypoint;
				expect(existsSync(initialEntrypoint)).toBe(true);

				// Trigger rebuild by modifying source
				await FS.writeFile(
					appFile,
					`self.addEventListener("fetch", () => new Response("v2"));`,
				);

				// Wait for rebuild callback
				const startTime = Date.now();
				while (!onBuildCalled && Date.now() - startTime < 5000) {
					await new Promise((r) => setTimeout(r, 50));
				}

				// Verify onBuild was called with valid new path
				expect(onBuildCalled).toBe(true);
				expect(receivedEntrypoint).not.toBeNull();
				expect(existsSync(receivedEntrypoint)).toBe(true);
			} finally {
				process.chdir(originalCwd);
				await watcher.stop();
			}
		} finally {
			await FS.rm(fixtureDir, {recursive: true, force: true});
		}
	},
	TIMEOUT,
);
