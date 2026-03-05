/**
 * Web Platform Dev Server
 *
 * Node.js HTTP server for development of browser Service Worker apps.
 * This file is dynamically imported and NEVER included in the browser bundle.
 *
 * Routes:
 * - /sw.js → serves the built Service Worker bundle
 * - /__shovel/events → SSE endpoint for live reload
 * - /static/* → serves content-hashed assets from dist/public/static/
 * - Everything else → HTML shell that registers the SW
 */

import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {readFile, stat} from "node:fs/promises";
import {dirname, join, extname} from "node:path";
import type {DevServerOptions, DevServer} from "@b9g/platform/module";

// Simple MIME type map for static assets
const MIME_TYPES: Record<string, string> = {
	".js": "application/javascript",
	".mjs": "application/javascript",
	".css": "text/css",
	".html": "text/html",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".webp": "image/webp",
	".avif": "image/avif",
	".webm": "video/webm",
	".mp4": "video/mp4",
	".wasm": "application/wasm",
};

function getMimeType(filePath: string): string {
	return MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
}

/**
 * HTML shell that registers the Service Worker and handles live reload.
 *
 * On first visit: registers /sw.js as a module SW → waits for activation → reloads.
 * SSE listener watches for `reload` events → re-registers SW → reloads page.
 */
function getHTMLShell(_port: number): string {
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shovel Dev</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
  .loading { text-align: center; color: #666; }
  .loading h2 { font-weight: 400; }
  .spinner { width: 40px; height: 40px; border: 3px solid #ddd; border-top-color: #333; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="loading">
  <div class="spinner"></div>
  <h2>Starting Service Worker...</h2>
  <p id="status">Registering...</p>
</div>
<script type="module">
const status = document.getElementById("status");

async function registerAndActivate() {
  try {
    if (!("serviceWorker" in navigator)) {
      status.textContent = "Service Workers not supported in this browser.";
      return;
    }

    status.textContent = "Registering Service Worker...";
    const reg = await navigator.serviceWorker.register("/sw.js", { type: "module" });

    // Wait for the SW to be active
    const sw = reg.installing || reg.waiting || reg.active;
    if (sw && sw.state !== "activated") {
      await new Promise((resolve) => {
        sw.addEventListener("statechange", () => {
          if (sw.state === "activated") resolve();
        });
      });
    }

    // If this is the first activation, reload so the SW handles the page
    if (!navigator.serviceWorker.controller) {
      status.textContent = "Service Worker activated, reloading...";
      location.reload();
      return;
    }

    // SW is controlling this page — it should have handled the request
    // If we're still seeing this shell, the SW didn't intercept. Reload once more.
    status.textContent = "Ready";
  } catch (err) {
    status.textContent = "Error: " + err.message;
    console.error("SW registration failed:", err);
  }
}

// Live reload via SSE
function connectSSE() {
  const evtSource = new EventSource("/__shovel/events");
  evtSource.addEventListener("reload", async () => {
    status.textContent = "Reloading Service Worker...";
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      await reg.update();
      // Wait for the new SW to activate
      const newSW = reg.installing || reg.waiting;
      if (newSW) {
        await new Promise((resolve) => {
          newSW.addEventListener("statechange", () => {
            if (newSW.state === "activated") resolve();
          });
        });
      }
    }
    location.reload();
  });
  evtSource.onerror = () => {
    evtSource.close();
    // Reconnect after a delay
    setTimeout(connectSSE, 2000);
  };
}

registerAndActivate();
connectSSE();
</script>
</body>
</html>`;
}

/**
 * Create a development server for browser Service Worker apps.
 */
export async function createWebDevServer(
	options: DevServerOptions,
): Promise<DevServer> {
	const {port, host, workerPath} = options;

	// Derive public assets directory from worker path
	// workerPath is e.g. dist/server/worker.js → outDir is dist → public is dist/public
	const outDir = dirname(dirname(workerPath));
	const publicDir = join(outDir, "public");

	// SSE clients for live reload
	const sseClients = new Set<ServerResponse>();

	let currentWorkerPath = workerPath;

	const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
		const url = new URL(req.url || "/", `http://${host}:${port}`);
		const pathname = url.pathname;

		try {
			// Serve the Service Worker bundle
			if (pathname === "/sw.js") {
				const content = await readFile(currentWorkerPath, "utf-8");
				res.writeHead(200, {
					"Content-Type": "application/javascript",
					"Cache-Control": "no-cache",
					"Service-Worker-Allowed": "/",
				});
				res.end(content);
				return;
			}

			// SSE endpoint for live reload
			if (pathname === "/__shovel/events") {
				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					"Connection": "keep-alive",
					"Access-Control-Allow-Origin": "*",
				});
				res.write(":\n\n"); // SSE comment to keep connection alive
				sseClients.add(res);
				req.on("close", () => {
					sseClients.delete(res);
				});
				return;
			}

			// Serve static assets from dist/public/
			if (pathname.startsWith("/static/")) {
				const filePath = join(publicDir, pathname);
				try {
					const fileStat = await stat(filePath);
					if (fileStat.isFile()) {
						const content = await readFile(filePath);
						res.writeHead(200, {
							"Content-Type": getMimeType(filePath),
							"Cache-Control": "public, max-age=31536000, immutable",
						});
						res.end(content);
						return;
					}
				} catch {
					// Fall through to 404
				}

				res.writeHead(404, {"Content-Type": "text/plain"});
				res.end("Not Found");
				return;
			}

			// Everything else → HTML shell
			const html = getHTMLShell(port);
			res.writeHead(200, {
				"Content-Type": "text/html",
				"Cache-Control": "no-cache",
			});
			res.end(html);
		} catch (err) {
			console.error("Dev server error:", err);
			res.writeHead(500, {"Content-Type": "text/plain"});
			res.end("Internal Server Error");
		}
	});

	await new Promise<void>((resolve) => {
		server.listen(port, host, () => resolve());
	});

	const serverUrl = `http://${host}:${port}`;

	return {
		url: serverUrl,

		async reload(newWorkerPath: string) {
			currentWorkerPath = newWorkerPath;

			// Notify all SSE clients to reload
			for (const client of sseClients) {
				client.write("event: reload\ndata: {}\n\n");
			}
		},

		async close() {
			// Close all SSE connections
			for (const client of sseClients) {
				client.end();
			}
			sseClients.clear();

			await new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			});
		},
	};
}
