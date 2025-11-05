/**
 * Production build system for Shovel apps
 * Pre-compiles ServiceWorker code for Worker execution at runtime
 */

import * as esbuild from "esbuild";
import {resolve, join, dirname} from "path";
import {mkdir, readFile, writeFile} from "fs/promises";
import {assetsPlugin} from "./assets.ts";
// Platform-specific imports are handled dynamically

// Workspace packages should resolve automatically via Node.js module resolution

/**
 * Build ServiceWorker app for production deployment
 * Supports multiple target platforms
 */
export async function buildForProduction({entrypoint, outDir, verbose, platform = "node"}) {
	const entryPath = resolve(entrypoint);
	const outputDir = resolve(outDir);

	if (verbose) {
		console.info(`📂 Entry: ${entryPath}`);
		console.info(`📂 Output: ${outputDir}`);
		console.info(`🎯 Target platform: ${platform}`);
	}

	// Ensure output directory exists
	await mkdir(outputDir, {recursive: true});

	// Find workspace root by looking for package.json with workspaces
	let workspaceRoot = process.cwd();
	while (workspaceRoot !== dirname(workspaceRoot)) {
		try {
			const packageJson = JSON.parse(
				await readFile(resolve(workspaceRoot, "package.json"), "utf8"),
			);
			if (packageJson.workspaces) {
				break;
			}
		} catch {
			// No package.json found, continue up the tree
		}
		workspaceRoot = dirname(workspaceRoot);
	}

	// Platform-specific build configuration
	const isCloudflare = platform === "cloudflare" || platform === "cloudflare-workers";
	
	// Build ServiceWorker code (keep as ServiceWorker, just bundle dependencies)
	const buildConfig = {
		entryPoints: [entryPath],
		bundle: true,
		format: "esm",
		target: "es2022",
		platform: isCloudflare ? "browser" : "node",
		outfile: join(outputDir, "app.js"),
		absWorkingDir: workspaceRoot,
		plugins: [
			assetsPlugin({
				outputDir: join(outputDir, "assets"),
				manifest: join(outputDir, "assets/manifest.json"),
				dev: false,
			}),
		],
		metafile: true,
		sourcemap: false,
		minify: false,
		treeShaking: true,
		define: {
			"process.env.NODE_ENV": '"production"',
		},
	};
	
	// Platform-specific bundling strategy
	if (!isCloudflare) {
		// For Node.js/Bun builds with bootstrap, bundle everything for self-contained executable
		// Only keep Node.js built-ins external since they're provided by the runtime
		buildConfig.external = ["node:*"];
	} else {
		// For Cloudflare, bundle everything and wrap ServiceWorker as ES Module
		buildConfig.platform = "browser";
		buildConfig.conditions = ["worker", "browser"];
		
		// Dynamically import Cloudflare platform utilities
		try {
			const {cloudflareWorkerBanner, cloudflareWorkerFooter} = await import("@b9g/platform-cloudflare");
			buildConfig.banner = {
				js: cloudflareWorkerBanner,
			};
			buildConfig.footer = {
				js: cloudflareWorkerFooter,
			};
		} catch (error) {
			throw new Error("@b9g/platform-cloudflare is required for Cloudflare builds. Install it with: bun add @b9g/platform-cloudflare");
		}
	}
	
	const result = await esbuild.build(buildConfig);

	if (verbose && result.metafile) {
		console.info("📊 Bundle analysis:");
		const analysis = await esbuild.analyzeMetafile(result.metafile);
		console.info(analysis);
	}

	// Add platform-specific bootstrapping to make output directly executable
	if (verbose) {
		console.info(`🔍 Platform: ${platform}, isCloudflare: ${isCloudflare}`);
	}
	if (!isCloudflare) {
		if (verbose) {
			console.info(`🔧 Adding platform bootstrap for ${platform}...`);
		}
		await addPlatformBootstrap(outputDir, platform, verbose, workspaceRoot);
	} else {
		if (verbose) {
			console.info(`🚫 Skipping bootstrap for Cloudflare platform`);
		}
	}

	if (verbose) {
		console.info(`📦 Built app to ${outputDir}`);
	}
}

/**
 * Add platform-specific bootstrapping code to make build output directly executable
 */
async function addPlatformBootstrap(outputDir, platform, verbose, workspaceRoot) {
	const appJsPath = join(outputDir, "app.js");
	const originalContent = await readFile(appJsPath, "utf8");
	
	// Keep the ServiceWorker code separate
	const workerJsPath = join(outputDir, "worker.js");
	await writeFile(workerJsPath, originalContent, "utf8");
	
	let bootstrapCode;
	
	if (platform === "node") {
		// First, we need to build the platform imports into a separate bundle
		const platformBootstrapPath = join(outputDir, "platform-bootstrap.js");
		
		// Create a temporary file that imports all platform dependencies
		const platformImports = `
export { createPlatform, ServiceWorkerRuntime, createServiceWorkerGlobals, createBucketStorage } from "@b9g/platform";
export { Worker } from "worker_threads";
export { default as os } from "os";
export { fileURLToPath } from "url";
export { dirname, join } from "path";
`;
		
		await writeFile(join(outputDir, "platform-imports.js"), platformImports, "utf8");
		
		// Bundle the platform imports
		const platformBuildConfig = {
			entryPoints: [join(outputDir, "platform-imports.js")],
			bundle: true,
			format: "esm",
			target: "es2022",
			platform: "node",
			outfile: platformBootstrapPath,
			absWorkingDir: workspaceRoot,
			external: ["node:*", "worker_threads", "os", "url", "path"], // Keep Node.js built-ins external
			minify: false,
		};
		
		await esbuild.build(platformBuildConfig);
		
		bootstrapCode = `#!/usr/bin/env node
/**
 * Shovel Production Server - Node.js Runtime
 * Generated build artifact - directly executable
 */

// Import platform utilities from bundled platform code
import { createPlatform, ServiceWorkerRuntime, createServiceWorkerGlobals, createBucketStorage, Worker, os, fileURLToPath, dirname, join } from "./platform-bootstrap.js";

// Configuration
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || "0.0.0.0";
const WORKERS = process.env.WORKERS ? parseInt(process.env.WORKERS) : os.cpus().length;

// Get paths relative to this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workerPath = join(__dirname, "worker.js");

async function startServer() {
  try {
    // Option 1: Use Worker threads (recommended for production scaling)
    if (WORKERS > 1) {
      // Create Node.js platform instance for worker-based deployment
      const platformInstance = await createPlatform("node", {
        hotReload: false,
        port: PORT,
        host: HOST,
      });

      console.info(\`🚀 Starting Shovel production server...\`);
      console.info(\`⚙️  Workers: \${WORKERS}\`);
      console.info(\`🌐 Platform: Node.js (Multi-threaded)\`);

      // Load ServiceWorker from file using worker threads
      const serviceWorker = await platformInstance.loadServiceWorker(workerPath, {
        hotReload: false,
        workerCount: WORKERS,
        caches: {
          pages: { type: "memory", maxEntries: 1000 },
          api: { type: "memory", ttl: 300 },
          static: { type: "memory" },
        },
      });

      // Create production server
      const server = platformInstance.createServer(serviceWorker.handleRequest, {
        port: PORT,
        host: HOST,
      });

      await server.listen();
      console.info(\`🚀 Server running at http://\${HOST}:\${PORT}\`);
      console.info(\`📁 Workers: \${WORKERS} threads\`);

      // Graceful shutdown
      const shutdown = async () => {
        console.info("\\n🛑 Shutting down...");
        await serviceWorker.dispose();
        await platformInstance.dispose();
        await server.close();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

    } else {
      // Option 2: Direct execution (single-threaded, no worker overhead)
      console.info(\`🚀 Starting Shovel production server...\`);
      console.info(\`⚙️  Workers: 1 (direct execution)\`);
      console.info(\`🌐 Platform: Node.js (Single-threaded)\`);

      // Create ServiceWorker runtime environment directly
      const runtime = new ServiceWorkerRuntime();
      const buckets = createBucketStorage(__dirname);
      
      // Set up ServiceWorker globals for the worker module
      const swGlobals = createServiceWorkerGlobals(runtime, { buckets });
      
      // Apply globals to current context for worker.js import
      globalThis.self = swGlobals.self;
      globalThis.addEventListener = swGlobals.addEventListener;
      globalThis.removeEventListener = swGlobals.removeEventListener;
      globalThis.dispatchEvent = swGlobals.dispatchEvent;
      globalThis.skipWaiting = swGlobals.skipWaiting;
      globalThis.clients = swGlobals.clients;
      globalThis.caches = swGlobals.self.caches || {};
      globalThis.buckets = swGlobals.self.buckets || buckets;

      // Load the ServiceWorker code directly (no import cache busting needed)
      await import(workerPath);
      
      // Run ServiceWorker lifecycle
      await runtime.install();
      await runtime.activate();

      // Create minimal HTTP server that forwards to ServiceWorker runtime
      const { createServer } = await import("http");
      const httpServer = createServer(async (req, res) => {
        try {
          // Convert Node.js request to Web API Request
          const url = \`http://\${req.headers.host}\${req.url}\`;
          const request = new Request(url, {
            method: req.method,
            headers: req.headers,
            body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
          });

          // Handle request via ServiceWorker runtime
          const response = await runtime.handleRequest(request);

          // Convert Web API Response to Node.js response
          res.statusCode = response.status;
          res.statusMessage = response.statusText;

          // Set headers
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });

          // Stream response body
          if (response.body) {
            const reader = response.body.getReader();
            const pump = async () => {
              const {done, value} = await reader.read();
              if (done) {
                res.end();
              } else {
                res.write(value);
                await pump();
              }
            };
            await pump();
          } else {
            res.end();
          }
        } catch (error) {
          console.error("Request error:", error);
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/plain");
          res.end("Internal Server Error");
        }
      });

      await new Promise((resolve) => {
        httpServer.listen(PORT, HOST, () => {
          console.info(\`🚀 Server running at http://\${HOST}:\${PORT}\`);
          console.info(\`📁 Direct ServiceWorker execution\`);
          resolve();
        });
      });

      // Graceful shutdown
      const shutdown = async () => {
        console.info("\\n🛑 Shutting down...");
        await new Promise((resolve) => httpServer.close(resolve));
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    }

  } catch (error) {
    console.error(\`❌ Failed to start server:\`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

startServer();
`;
	} else if (platform === "bun") {
		bootstrapCode = `#!/usr/bin/env bun
/**
 * Shovel Production Server - Bun Runtime
 * Generated build artifact - directly executable
 */

// Import platform utilities
import { createPlatform } from "@b9g/platform";

// Configuration
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || "0.0.0.0";
const WORKERS = process.env.WORKERS ? parseInt(process.env.WORKERS) : navigator.hardwareConcurrency || 4;

// Get worker path relative to this script
const workerPath = new URL("./worker.js", import.meta.url).pathname;

async function startServer() {
  try {
    // Create Bun platform instance
    const platformInstance = await createPlatform("bun", {
      hotReload: false,
      port: PORT,
      host: HOST,
    });

    console.info(\`🚀 Starting Shovel production server...\`);
    console.info(\`⚙️  Workers: \${WORKERS}\`);
    console.info(\`🌐 Platform: Bun\`);

    // Load ServiceWorker from file
    const serviceWorker = await platformInstance.loadServiceWorker(workerPath, {
      hotReload: false,
      workerCount: WORKERS,
      caches: {
        pages: { type: "memory", maxEntries: 1000 },
        api: { type: "memory", ttl: 300 },
        static: { type: "memory" },
      },
    });

    // Create production server
    const server = platformInstance.createServer(serviceWorker.handleRequest, {
      port: PORT,
      host: HOST,
    });

    await server.listen();
    console.info(\`🚀 Server running at http://\${HOST}:\${PORT}\`);
    console.info(\`📁 Workers: \${WORKERS} threads\`);

    // Graceful shutdown
    process.on("SIGINT", async () => {
      console.info("\\n🛑 Shutting down...");
      await serviceWorker.dispose();
      await platformInstance.dispose();
      await server.close();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.info("\\n🛑 Shutting down...");
      await serviceWorker.dispose();
      await platformInstance.dispose();
      await server.close();
      process.exit(0);
    });

  } catch (error) {
    console.error(\`❌ Failed to start server:\`, error.message);
    process.exit(1);
  }
}

startServer();
`;
	} else {
		throw new Error(`Unsupported platform for direct execution: ${platform}`);
	}
	
	// Write the bootstrapped version
	await writeFile(appJsPath, bootstrapCode, "utf8");
	
	if (verbose) {
		console.info(`🔧 Added ${platform} bootstrap for direct execution`);
		console.info(`📄 ServiceWorker code: worker.js`);
	}
}
