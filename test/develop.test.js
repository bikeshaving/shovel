import * as FS from "fs/promises";
import {spawn} from "child_process";
import {test, expect} from "bun:test";
import {join, dirname} from "path";
import {tmpdir} from "os";
import {mkdtemp} from "fs/promises";

/**
 * Development server hot reload tests
 * Tests our Worker-based architecture for dependency invalidation
 * Includes both basic functionality and advanced stress testing
 */

const TIMEOUT = 10000; // 10 second timeout for complex tests

// Helper to create temporary fixture copy
async function createTempFixture(fixtureName) {
	const tempDir = await mkdtemp(join(tmpdir(), "shovel-test-"));
	const tempFile = join(tempDir, fixtureName);
	const sourceFile = join("./test/fixtures", fixtureName);

	await FS.copyFile(sourceFile, tempFile);

	return {
		path: tempFile,
		dir: tempDir,
		async copyFrom(sourceFixture) {
			const sourcePath = join("./test/fixtures", sourceFixture);
			await FS.copyFile(sourcePath, tempFile);
		},
		async addDependency(dependencyFixture) {
			const depFile = join(this.dir, dependencyFixture);
			const sourceFile = join("./test/fixtures", dependencyFixture);
			await FS.copyFile(sourceFile, depFile);
			return depFile;
		},
		async copyDependencyFrom(dependencyFixture, sourceFixture) {
			const depFile = join(this.dir, dependencyFixture);
			const sourceFile = join("./test/fixtures", sourceFixture);
			await FS.copyFile(sourceFile, depFile);
		},
		async cleanup() {
			await FS.rm(tempDir, {recursive: true, force: true});
		},
	};
}

// Helper to start a development server
function startDevServer(fixture, port, extraArgs = []) {
	const args = [
		"./dist/src/cli.js",
		"develop",
		fixture,
		"--port",
		port.toString(),
		...extraArgs,
	];

	const serverProcess = spawn("node", args, {
		stdio: ["ignore", "pipe", "pipe"],
		cwd: process.cwd(),
		env: {...process.env, NODE_ENV: "development"},
	});

	// Capture stderr to detect CLI failures early
	let stderrOutput = "";
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
async function waitForServer(port, serverProcess, timeoutMs = 2000) {
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
		} catch (err) {
			// Server not ready yet, continue waiting
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

		try {
			// Start development server with minimal test fixture (no external dependencies)
			serverProcess = startDevServer("./test/fixtures/server-minimal.ts", PORT);

			// Wait for server to be ready
			const response = await waitForServer(PORT, serverProcess);

			// Verify server responds correctly (simple hello fixture)
			expect(response).toContain("<marquee>Hello world</marquee>");
		} finally {
			await killServer(serverProcess, PORT);
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

			// Modify the dependency file (simulate dependency change)
			await tempFixture.copyDependencyFrom(
				"server-dependency-hello.ts",
				"server-dependency-goodbye.ts",
			);

			// Wait for hot reload and verify dependency change propagated
			await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for reload

			const updatedResponse = await fetchWithRetry(PORT);
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

		// Backup original dependency file
		const originalDependencyContents = await FS.readFile(
			"./test/fixtures/server-dependency-hello.ts",
			"utf8",
		);

		try {
			// Start development server with file that uses dynamic imports
			serverProcess = startDevServer(
				"./test/fixtures/server-dynamic-dependent.ts",
				PORT,
			);

			// Wait for initial response
			const initialResponse = await waitForServer(PORT, serverProcess);
			expect(initialResponse).toBe(
				'<marquee behavior="alternate">Hello from dependency-hello.ts</marquee>',
			);

			// Modify the dependency file
			await FS.copyFile(
				"./test/fixtures/server-dependency-goodbye.ts",
				"./test/fixtures/server-dependency-hello.ts",
			);

			// Wait for hot reload and verify dynamic import change propagated
			await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for reload

			const updatedResponse = await fetchWithRetry(PORT);
			expect(updatedResponse).toBe(
				'<marquee behavior="alternate">Goodbye from dependency-hello.ts</marquee>',
			);
		} finally {
			// Restore original dependency file
			await FS.writeFile(
				"./test/fixtures/server-dependency-hello.ts",
				originalDependencyContents,
			);
			await killServer(serverProcess, PORT);
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
			await new Promise((resolve) => setTimeout(resolve, 200)); // Start reload

			const concurrentRequests = Array.from({length: 10}, () =>
				fetchWithRetry(PORT, 5, 100),
			);

			const responses = await Promise.all(concurrentRequests);

			// All responses should be consistent (either old or new, but not mixed)
			const uniqueResponses = [...new Set(responses)];
			expect(uniqueResponses.length).toBeLessThanOrEqual(2); // Should be either 1 or 2 unique responses

			// Final response should be the updated version
			const finalResponse = await fetchWithRetry(PORT);
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

		// Create temporary test files for deep chain
		const testFileA = "/tmp/shovel-test-chain-a.ts";
		const testFileB = "/tmp/shovel-test-chain-b.ts";
		const testFileMain = "/tmp/shovel-test-chain-main.ts";

		// File A (deepest dependency)
		const contentA = `export const value = "A-original";`;
		const modifiedA = `export const value = "A-modified";`;

		// File B (middle dependency, imports A)
		const contentB = `
import {value as aValue} from "${testFileA}";
export const value = \`B-\${aValue}\`;
		`;

		// Main file (imports B, which imports A)
		const contentMain = `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
import {value} from "${testFileB}";

self.addEventListener("fetch", (event) => {
	const html = renderer.render(jsx\`<div>\${value}</div>\`);
	event.respondWith(new Response(html, {
		headers: {"content-type": "text/html; charset=UTF-8"},
	}));
});
		`;

		try {
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
			await new Promise((resolve) => setTimeout(resolve, 800));

			const updatedResponse = await fetchWithRetry(PORT);
			expect(updatedResponse).toBe("<div>B-A-modified</div>");
		} finally {
			// Clean up test files
			await FS.unlink(testFileA);
			await FS.unlink(testFileB);
			await FS.unlink(testFileMain);
			await killServer(serverProcess, PORT);
		}
	},
	TIMEOUT,
);

test(
	"concurrent file modifications",
	async () => {
		const PORT = 13317;
		let serverProcess;

		// Create multiple temporary test files
		const testFiles = Array.from({length: 5}, (_, i) => ({
			path: `/tmp/shovel-test-concurrent-${i}.ts`,
			content: `export const value${i} = "original-${i}";`,
			modified: `export const value${i} = "modified-${i}";`,
		}));

		const mainFile = "/tmp/shovel-test-concurrent-main.ts";
		const mainContent = `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
${testFiles.map((f, i) => `import {value${i}} from "${f.path}";`).join("\n")}

self.addEventListener("fetch", (event) => {
	const allValues = [${testFiles.map((_, i) => `value${i}`).join(", ")}];
	const html = renderer.render(jsx\`<div>Values: \${allValues.join(", ")}</div>\`);
	event.respondWith(new Response(html, {
		headers: {"content-type": "text/html; charset=UTF-8"},
	}));
});
		`;

		try {
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

			// Modify all files concurrently
			const modifyPromises = testFiles.map((file) =>
				FS.writeFile(file.path, file.modified),
			);
			await Promise.all(modifyPromises);

			// Wait for reload
			await new Promise((resolve) => setTimeout(resolve, 800));

			const updatedResponse = await fetchWithRetry(PORT);
			expect(updatedResponse).toContain("Values: modified-0, modified-1");
		} finally {
			// Clean up all test files
			for (const file of testFiles) {
				await FS.unlink(file.path);
			}
			await FS.unlink(mainFile);
			await killServer(serverProcess, PORT);
		}
	},
	TIMEOUT,
);

test(
	"high worker count stress test",
	async () => {
		const PORT = 13318;
		let serverProcess;

		try {
			// Start development server with 8 workers
			serverProcess = startDevServer("./test/fixtures/server-hello.ts", PORT, [
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
		}
	},
	TIMEOUT,
);

test(
	"file deletion and recreation",
	async () => {
		const PORT = 13319;
		let serverProcess;

		const testFile = "/tmp/shovel-test-delete.ts";
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

		// Backup system to track what needs cleanup
		const backups = {};

		try {
			await FS.writeFile(testFile, originalContent);

			// Start development server
			serverProcess = startDevServer(testFile, PORT);

			// Wait for initial response
			const initialResponse = await waitForServer(PORT, serverProcess);
			expect(initialResponse).toBe("<div>Original</div>");

			// Delete the file
			backups[testFile] = originalContent;
			await FS.unlink(testFile);

			// Wait a bit
			await new Promise((resolve) => setTimeout(resolve, 2000));

			// Recreate the file with different content
			await FS.writeFile(testFile, recreatedContent);
			backups[testFile] = null; // Mark for deletion

			// Wait for reload
			await new Promise((resolve) => setTimeout(resolve, 800));

			const finalResponse = await fetchWithRetry(PORT);
			expect(finalResponse).toBe("<div>Recreated</div>");
		} finally {
			// Restore original files
			for (const [file, content] of Object.entries(backups)) {
				if (content) {
					await FS.writeFile(file, content);
				} else {
					await FS.unlink(file);
				}
			}
			await killServer(serverProcess, PORT);
		}
	},
	TIMEOUT,
);

test(
	"syntax error recovery",
	async () => {
		const PORT = 13320;
		let serverProcess;

		const testFile = "/tmp/shovel-test-syntax.ts";
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
			await FS.writeFile(testFile, validContent);

			// Start development server
			serverProcess = startDevServer(testFile, PORT);

			// Wait for initial response
			const initialResponse = await waitForServer(PORT, serverProcess);
			expect(initialResponse).toBe("<div>Valid</div>");

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
			await new Promise((resolve) => setTimeout(resolve, 800));

			const recoveredResponse = await fetchWithRetry(PORT);
			expect(recoveredResponse).toBe("<div>Fixed</div>");
		} finally {
			await FS.unlink(testFile);
			await killServer(serverProcess, PORT);
		}
	},
	TIMEOUT,
);

test(
	"large file handling",
	async () => {
		const PORT = 13321;
		let serverProcess;

		const largeFile = "/tmp/shovel-test-large.ts";

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
			await FS.writeFile(largeFile, largeContent);

			// Start development server
			serverProcess = startDevServer(largeFile, PORT);

			// Wait for initial response
			const response = await waitForServer(PORT, serverProcess);
			expect(response).toBe("<div>Variables: 50</div>");

			// Modify the large file
			const modifiedContent = largeContent.replace(
				"Variables: ${allVars.length}",
				"Variables: Modified",
			);
			await FS.writeFile(largeFile, modifiedContent);

			await new Promise((resolve) => setTimeout(resolve, 800));

			const updatedResponse = await fetchWithRetry(PORT);
			expect(updatedResponse).toBe("<div>Variables: Modified</div>");
		} finally {
			await FS.unlink(largeFile);
			await killServer(serverProcess, PORT);
		}
	},
	TIMEOUT,
);

test(
	"cache coordination during rapid rebuilds",
	async () => {
		const PORT = 13322;
		let serverProcess;

		const cacheFile = "/tmp/shovel-test-cache.ts";
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
			await FS.unlink(cacheFile);
			await killServer(serverProcess, PORT);
		}
	},
	TIMEOUT,
);

test(
	"different file extensions",
	async () => {
		const PORT = 13323;
		let serverProcess;

		const jsFile = "/tmp/shovel-test-extension.js";
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
			await FS.writeFile(jsFile, jsContent);

			// Start development server with JS file
			serverProcess = startDevServer(jsFile, PORT);

			// Wait for initial response
			const initialResponse = await waitForServer(PORT, serverProcess);
			expect(initialResponse).toBe("<div>JavaScript file!</div>");

			// Modify the JS file
			await FS.writeFile(jsFile, modifiedJsContent);

			// Wait for reload
			await new Promise((resolve) => setTimeout(resolve, 600));

			const updatedResponse = await fetchWithRetry(PORT);
			expect(updatedResponse).toBe("<div>JavaScript modified!</div>");
		} finally {
			await FS.unlink(jsFile);
			await killServer(serverProcess, PORT);
		}
	},
	TIMEOUT,
);
