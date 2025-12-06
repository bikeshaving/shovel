/**
 * Echo - HTTP Request Echo API
 * Built with Shovel using the Router
 */

import {Router} from "@b9g/router";

const HOMEPAGE_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Echo - HTTP Request Echo API</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
    }
    h1 { font-size: 2.5rem; margin-bottom: 0.5rem; }
    h2 { margin-top: 2rem; margin-bottom: 1rem; border-bottom: 2px solid #eee; padding-bottom: 0.5rem; }
    h3 { margin-top: 1.5rem; margin-bottom: 0.5rem; }
    code {
      background: #f5f5f5;
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
      font-size: 0.9em;
    }
    pre {
      background: #f5f5f5;
      padding: 1rem;
      border-radius: 4px;
      overflow-x: auto;
      margin: 1rem 0;
    }
    pre code { background: none; padding: 0; }
    ul { margin-left: 2rem; margin-top: 0.5rem; }
    li { margin-bottom: 0.5rem; }
    .subtitle { color: #666; font-size: 1.1rem; margin-bottom: 2rem; }
    footer {
      margin-top: 4rem;
      padding-top: 2rem;
      border-top: 1px solid #eee;
      color: #666;
      font-size: 0.9rem;
    }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    details { margin: 1rem 0; }
    summary { cursor: pointer; font-weight: bold; margin-bottom: 0.5rem; }
    details[open] summary { margin-bottom: 1rem; }
  </style>
</head>
<body>
  <h1>Echo</h1>
  <p class="subtitle">HTTP request echo and debugging API</p>

  <h2>Endpoint</h2>
  <h3><code>ALL /echo</code></h3>
  <p>Echoes back complete request information including method, path, query params, headers, and body.</p>

  <pre><code>curl https://echo.shovel.run/echo</code></pre>

  <h2>Control Headers</h2>
  <p>Modify response behavior using <code>X-Echo-*</code> headers:</p>

  <h3><code>X-Echo-Delay</code></h3>
  <p>Delay response by specified seconds (1-10).</p>
  <pre><code>curl https://echo.shovel.run/echo -H "X-Echo-Delay: 3"</code></pre>

  <h3><code>X-Echo-Status</code></h3>
  <p>Return a specific HTTP status code (100-599).</p>
  <pre><code>curl https://echo.shovel.run/echo -H "X-Echo-Status: 404"</code></pre>

  <h3><code>X-Echo-CORS</code></h3>
  <p>Simulate CORS restrictions for testing cross-origin behavior.</p>
  <pre><code>curl https://echo.shovel.run/echo -H "X-Echo-CORS: origin:myapp.com"</code></pre>

  <h3><code>X-Echo-Cache</code></h3>
  <p>Control caching headers.</p>
  <pre><code>curl https://echo.shovel.run/echo -H "X-Echo-Cache: max-age:3600"</code></pre>

  <h3><code>X-Echo-Content-Type</code></h3>
  <p>Override response content type.</p>
  <pre><code>curl https://echo.shovel.run/echo -H "X-Echo-Content-Type: application/xml"</code></pre>

  <h2>Examples</h2>

  <h3>Basic Echo</h3>
  <pre><code>curl https://echo.shovel.run/echo?foo=bar</code></pre>
  <details>
    <summary>Example Response</summary>
    <pre><code>{
  "method": "GET",
  "path": "/echo",
  "query": {"foo": "bar"},
  "headers": {
    "user-agent": "curl/8.0.0",
    "accept": "*/*"
  },
  "timestamp": "2025-10-17T12:00:00.000Z",
  "body": null
}</code></pre>
  </details>

  <h3>POST with JSON</h3>
  <pre><code>curl -X POST https://echo.shovel.run/echo \\
  -H "Content-Type: application/json" \\
  -d '{"hello": "world"}'</code></pre>
  <details>
    <summary>Example Response</summary>
    <pre><code>{
  "method": "POST",
  "path": "/echo",
  "headers": {
    "content-type": "application/json"
  },
  "body": {"hello": "world"},
  "contentType": "application/json"
}</code></pre>
  </details>

  <h2>Features</h2>
  <ul>
    <li>Full CORS support with simulation</li>
    <li>All HTTP methods supported</li>
    <li>JSON, form data, and text body parsing</li>
    <li>Cache control headers</li>
    <li>Content type overrides</li>
    <li>Status code and delay control</li>
    <li>Clean header-based control mechanism</li>
  </ul>

  <h2>Use Cases</h2>
  <ul>
    <li>Webhook testing and debugging</li>
    <li>HTTP client development</li>
    <li>CORS policy validation</li>
    <li>Frontend integration testing</li>
    <li>API error handling</li>
    <li>Loading state demonstrations</li>
    <li>HTTP fundamentals learning</li>
    <li>Cache behavior validation</li>
  </ul>

  <footer>
    <p>Built with <a href="https://github.com/anthropics/shovel">Shovel</a></p>
  </footer>
</body>
</html>`;

// Helper functions
function getRequestInfo(req: Request) {
	const url = new URL(req.url);
	const headers: Record<string, string> = {};
	req.headers.forEach((value, key) => {
		headers[key] = value;
	});

	return {
		method: req.method,
		path: url.pathname,
		query: Object.fromEntries(url.searchParams),
		headers,
		timestamp: new Date().toISOString(),
	};
}

async function parseBody(req: Request) {
	if (req.method === "GET" || req.method === "HEAD") {
		return null;
	}

	const contentType = req.headers.get("content-type");
	try {
		if (contentType?.includes("application/json")) {
			return await req.json();
		} else if (contentType?.includes("application/x-www-form-urlencoded")) {
			const formData = await req.formData();
			return Object.fromEntries(formData);
		} else if (contentType?.includes("multipart/form-data")) {
			const formData = await req.formData();
			return Object.fromEntries(formData);
		} else {
			const text = await req.text();
			return text || null;
		}
	} catch {
		return null;
	}
}

function parseCorsHeader(
	corsHeader: string | null,
): Record<string, string> | null {
	if (!corsHeader) {
		return {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods":
				"GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
			"Access-Control-Allow-Headers": "*",
		};
	}

	if (corsHeader === "block") {
		return null;
	}

	const headers: Record<string, string> = {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods":
			"GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
		"Access-Control-Allow-Headers": "*",
	};

	if (corsHeader.includes("origin:")) {
		const match = corsHeader.match(/origin:([^,]+)/);
		if (match) headers["Access-Control-Allow-Origin"] = match[1].trim();
	}

	if (corsHeader.includes("methods:")) {
		const match = corsHeader.match(/methods:([^,]+(?:,[^:]+)*)/);
		if (match) headers["Access-Control-Allow-Methods"] = match[1].trim();
	}

	if (corsHeader.includes("headers:")) {
		const match = corsHeader.match(/headers:([^,]+(?:,[^:]+)*)/);
		if (match) headers["Access-Control-Allow-Headers"] = match[1].trim();
	}

	if (corsHeader.includes("credentials:")) {
		const match = corsHeader.match(/credentials:([^,]+)/);
		if (match) headers["Access-Control-Allow-Credentials"] = match[1].trim();
	}

	return headers;
}

function parseCacheHeader(cacheHeader: string | null): Record<string, string> {
	if (!cacheHeader) return {};

	const headers: Record<string, string> = {};
	const params = cacheHeader.split(",").map((p) => p.trim());

	for (const param of params) {
		if (param === "no-cache") {
			headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
			headers["Pragma"] = "no-cache";
			headers["Expires"] = "0";
		} else if (param.startsWith("max-age:")) {
			headers["Cache-Control"] = `max-age=${param.split(":")[1]}`;
		} else if (param.startsWith("etag:")) {
			headers["ETag"] = `"${param.split(":")[1]}"`;
		}
	}

	return headers;
}

// Create router
const router = new Router();

// Homepage
router.route("/").get(() => {
	return new Response(HOMEPAGE_HTML, {
		headers: {"Content-Type": "text/html"},
	});
});

// Echo endpoint - handles all methods
router.route("/echo").all(async (request) => {
	const corsHeader = request.headers.get("x-echo-cors");
	const corsHeaders = parseCorsHeader(corsHeader);

	// Handle preflight
	if (request.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: corsHeaders || {},
		});
	}

	// Parse control headers
	const delayHeader = request.headers.get("x-echo-delay");
	const statusHeader = request.headers.get("x-echo-status");
	const cacheHeader = request.headers.get("x-echo-cache");
	const contentTypeHeader = request.headers.get("x-echo-content-type");

	// Validate delay
	let delay = 0;
	if (delayHeader) {
		const parsed = parseInt(delayHeader);
		if (isNaN(parsed) || parsed < 1 || parsed > 10) {
			return Response.json(
				{error: "X-Echo-Delay must be between 1 and 10"},
				{status: 400, headers: corsHeaders || {}},
			);
		}
		delay = parsed;
	}

	// Validate status
	let statusCode = 200;
	if (statusHeader) {
		const parsed = parseInt(statusHeader);
		if (isNaN(parsed) || parsed < 100 || parsed > 599) {
			return Response.json(
				{error: "X-Echo-Status must be between 100 and 599"},
				{status: 400, headers: corsHeaders || {}},
			);
		}
		statusCode = parsed;
	}

	// Apply delay
	if (delay > 0) {
		await new Promise((resolve) => setTimeout(resolve, delay * 1000));
	}

	// Build response
	const info = getRequestInfo(request);
	const body = await parseBody(request);

	const response: Record<string, unknown> = {
		...info,
		body,
		contentType: request.headers.get("content-type") || null,
	};

	if (delay > 0) {
		response.delayed = `${delay} seconds`;
	}
	if (statusCode !== 200) {
		response.requestedStatus = statusCode;
	}

	const responseHeaders: Record<string, string> = {
		...(corsHeaders || {}),
		...parseCacheHeader(cacheHeader),
	};

	if (contentTypeHeader) {
		responseHeaders["Content-Type"] = contentTypeHeader;
	}

	return Response.json(response, {
		status: statusCode,
		headers: responseHeaders,
	});
});

// 404 handler
router.use(async function* (request) {
	const response: Response | undefined = yield request;
	if (response) return response;

	const url = new URL(request.url);
	return Response.json(
		{
			error: "Not found",
			path: url.pathname,
			suggestion: "Try /echo or see / for documentation",
		},
		{
			status: 404,
			headers: parseCorsHeader(null) || {},
		},
	);
});

// ServiceWorker event handlers
self.addEventListener("install", () => {
	console.info("[Echo] ServiceWorker installed");
});

self.addEventListener("activate", () => {
	console.info("[Echo] ServiceWorker activated");
});

self.addEventListener("fetch", (event) => {
	event.respondWith(router.handle(event.request));
});

// Export for testing
export {router, HOMEPAGE_HTML};
