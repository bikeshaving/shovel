/**
 * Echo - HTTP Request Echo API
 * Built with Shovel using the Router
 */

import {Router} from "@b9g/router";

const logger = self.loggers.get(["echo"]);

const STYLES = `
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
    .json-key { color: #881391; }
    .json-string { color: #1a1aa6; }
    .json-number { color: #1c00cf; }
    .json-boolean { color: #0d22aa; }
    .json-null { color: #808080; }
    .fetch-demo { margin: 1.5rem 0; }
    .fetch-demo .controls {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .fetch-demo select {
      padding: 0.4rem;
      border: 1px solid #ccc;
      border-radius: 3px;
      font-size: 0.9rem;
    }
    .fetch-demo input[type="text"] {
      flex: 1;
      padding: 0.4rem 0.6rem;
      border: 1px solid #ccc;
      border-radius: 3px;
      font-family: monospace;
      font-size: 0.9rem;
    }
    .fetch-demo textarea {
      width: 100%;
      min-height: 4rem;
      padding: 0.6rem;
      border: 1px solid #ccc;
      border-radius: 3px;
      font-family: monospace;
      font-size: 0.9rem;
      margin-bottom: 0.5rem;
      resize: vertical;
    }
    .fetch-demo button {
      padding: 0.4rem 1.2rem;
      background: #0066cc;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .fetch-demo button:hover { background: #0052a3; }
    .fetch-demo button:disabled { background: #999; cursor: default; }
    .fetch-demo .status { font-size: 0.85rem; color: #666; margin-bottom: 0.5rem; }
`;

const HOMEPAGE_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Echo - HTTP Request Echo API</title>
  <style>${STYLES}</style>
</head>
<body>
  <h1>Echo</h1>
  <p class="subtitle">HTTP request echo and debugging API</p>

  <h2>Try it</h2>
  <div id="fetch-demo"></div>
  <noscript><pre><code>curl https://echo.shovel.run/anything</code></pre></noscript>

  <h2>Control Headers</h2>
  <p>Modify response behavior using <code>X-Echo-*</code> headers:</p>

  <pre><code>curl https://echo.shovel.run/anything -H "X-Echo-Status: 404"
curl https://echo.shovel.run/anything -H "X-Echo-CORS: origin:myapp.com"
curl https://echo.shovel.run/anything -H "X-Echo-Cache: max-age:3600"
curl https://echo.shovel.run/anything -H "X-Echo-Content-Type: application/xml"</code></pre>

  <footer>
    <p>Built with <a href="https://github.com/bikeshaving/shovel">Shovel</a></p>
  </footer>

  <script type="module">
    import {jsx} from "https://esm.sh/@b9g/crank@0.7/standalone";
    import {renderer} from "https://esm.sh/@b9g/crank@0.7/dom";

    function* FetchDemo() {
      let method = "GET";
      let path = "/hello";
      let body = "";
      let result = null;
      let status = null;
      let loading = false;

      const send = async () => {
        loading = true;
        this.refresh();
        try {
          const opts = {method, headers: {"Accept": "application/json"}};
          if (method !== "GET" && method !== "HEAD" && body) {
            opts.body = body;
            opts.headers["Content-Type"] = "application/json";
          }
          const res = await fetch(path, opts);
          status = res.status;
          result = await res.json();
        } catch (e) {
          status = null;
          result = {error: e.message};
        }
        loading = false;
        this.refresh();
      };

      for ({} of this) {
        yield jsx\`
          <div class="fetch-demo">
            <div class="controls">
              <select onchange=\${(e) => { method = e.target.value; this.refresh(); }}>
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
                <option>DELETE</option>
                <option>PATCH</option>
              </select>
              <input type="text" value=\${path}
                oninput=\${(e) => { path = e.target.value; }}
                onkeydown=\${(e) => { if (e.key === "Enter") send(); }} />
              <button onclick=\${send} disabled=\${loading}>
                \${loading ? "..." : "Send"}
              </button>
            </div>
            \${method !== "GET" && method !== "HEAD" ? jsx\`
              <textarea placeholder="Request body (JSON)"
                oninput=\${(e) => { body = e.target.value; }}>\${body}</textarea>
            \` : null}
            \${status != null ? jsx\`<div class="status">\${status}</div>\` : null}
            \${result ? jsx\`<pre><code>\${JSON.stringify(result, null, 2)}</code></pre>\` : null}
          </div>
        \`;
      }
    }

    renderer.render(
      jsx\`<\${FetchDemo} />\`,
      document.getElementById("fetch-demo"),
    );
  </script>
</body>
</html>`;

function syntaxHighlightJson(json: string): string {
	return json.replace(
		/("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|(\b\d+\.?\d*\b)|(true|false)|(null)/g,
		(match, key, str, num, bool, nil) => {
			if (key) return `<span class="json-key">${key}</span>:`;
			if (str) return `<span class="json-string">${str}</span>`;
			if (num) return `<span class="json-number">${num}</span>`;
			if (bool) return `<span class="json-boolean">${bool}</span>`;
			if (nil) return `<span class="json-null">${nil}</span>`;
			return match;
		},
	);
}

function renderJsonHtml(data: unknown, statusCode: number): string {
	const json = JSON.stringify(data, null, 2);
	const highlighted = syntaxHighlightJson(json);
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Echo ${statusCode}</title>
  <style>${STYLES}</style>
</head>
<body>
  <h1><a href="/">Echo</a></h1>
  <pre><code>${highlighted}</code></pre>
  <footer>
    <p>Built with <a href="https://github.com/bikeshaving/shovel">Shovel</a></p>
  </footer>
</body>
</html>`;
}

// Helper functions
function getRequestInfo(req: Request) {
	const url = new URL(req.url);
	const stripPrefixes = ["cf-", "x-real-ip", "x-forwarded-"];
	const headers: Record<string, string> = {};
	req.headers.forEach((value, key) => {
		if (!stripPrefixes.some((p) => key.startsWith(p))) {
			headers[key] = value;
		}
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
			return Object.fromEntries(
				formData as unknown as Iterable<readonly [PropertyKey, unknown]>,
			);
		} else if (contentType?.includes("multipart/form-data")) {
			const formData = await req.formData();
			return Object.fromEntries(
				formData as unknown as Iterable<readonly [PropertyKey, unknown]>,
			);
		} else {
			const text = await req.text();
			return text || null;
		}
	} catch (_err: unknown) {
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

function wantsBrowserResponse(request: Request): boolean {
	const accept = request.headers.get("accept") || "";
	return accept.includes("text/html");
}

// Create router
const router = new Router();

// Homepage
router.route("/").get(() => {
	return new Response(HOMEPAGE_HTML, {
		headers: {"Content-Type": "text/html"},
	});
});

// Echo endpoint - handles all methods on any path
router.route("/*").all(async (request) => {
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
	const statusHeader = request.headers.get("x-echo-status");
	const cacheHeader = request.headers.get("x-echo-cache");
	const contentTypeHeader = request.headers.get("x-echo-content-type");

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

	// Build response
	const info = getRequestInfo(request);
	const body = await parseBody(request);

	const response: Record<string, unknown> = {
		...info,
		body,
	};

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

	// Pretty HTML for browsers, raw JSON for API clients
	if (wantsBrowserResponse(request) && !contentTypeHeader) {
		return new Response(renderJsonHtml(response, statusCode), {
			status: statusCode,
			headers: {...responseHeaders, "Content-Type": "text/html"},
		});
	}

	return Response.json(response, {
		status: statusCode,
		headers: responseHeaders,
	});
});

// ServiceWorker event handlers
self.addEventListener("install", () => {
	logger.info`ServiceWorker installed`;
});

self.addEventListener("activate", () => {
	logger.info`ServiceWorker activated`;
});

self.addEventListener("fetch", (event) => {
	event.respondWith(router.handle(event.request));
});

// Export for testing
export {router, HOMEPAGE_HTML};
