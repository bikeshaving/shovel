const HOMEPAGE_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>reqback - HTTP Request Echo API</title>
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
  <h1>reqback</h1>
  <p class="subtitle">HTTP request echo and debugging API</p>

  <h2>Endpoint</h2>
  <h3><code>ALL /echo</code></h3>
  <p>Echoes back complete request information including method, path, query params, headers, body, and IP address.</p>

  <pre><code>curl https://reqback.fly.dev/echo</code></pre>

  <h2>Control Headers</h2>
  <p>Modify response behavior using <code>X-Reqback-*</code> headers:</p>

  <h3><code>X-Reqback-Delay</code></h3>
  <p>Delay response by specified seconds (1-10).</p>
  <pre><code>curl https://reqback.fly.dev/echo -H "X-Reqback-Delay: 3"</code></pre>

  <h3><code>X-Reqback-Status</code></h3>
  <p>Return a specific HTTP status code (100-599).</p>
  <pre><code>curl https://reqback.fly.dev/echo -H "X-Reqback-Status: 404"</code></pre>

  <h3><code>X-Reqback-CORS</code></h3>
  <p>Simulate CORS restrictions for testing cross-origin behavior.</p>
  <pre><code>curl https://reqback.fly.dev/echo -H "X-Reqback-CORS: origin:myapp.com"</code></pre>

  <h3><code>X-Reqback-Auth</code></h3>
  <p>Simulate authentication scenarios.</p>
  <pre><code>curl https://reqback.fly.dev/echo -H "X-Reqback-Auth: bearer:secret123"</code></pre>

  <h3><code>X-Reqback-Redirect</code></h3>
  <p>Test redirect scenarios.</p>
  <pre><code>curl https://reqback.fly.dev/echo -H "X-Reqback-Redirect: 301:https://example.com"</code></pre>

  <h3><code>X-Reqback-Cache</code></h3>
  <p>Control caching headers.</p>
  <pre><code>curl https://reqback.fly.dev/echo -H "X-Reqback-Cache: max-age:3600"</code></pre>

  <h3><code>X-Reqback-Content-Type</code></h3>
  <p>Override response content type.</p>
  <pre><code>curl https://reqback.fly.dev/echo -H "X-Reqback-Content-Type: application/xml"</code></pre>

  <h2>Examples</h2>

  <h3>Basic Echo</h3>
  <pre><code>curl https://reqback.fly.dev/echo?foo=bar</code></pre>
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
  "ip": "1.2.3.4",
  "timestamp": "2025-10-17T12:00:00.000Z",
  "body": null
}</code></pre>
  </details>

  <h3>POST with JSON</h3>
  <pre><code>curl -X POST https://reqback.fly.dev/echo \\
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

  <h3>Authentication Test</h3>
  <pre><code>curl https://reqback.fly.dev/echo \\
  -H "X-Reqback-Auth: bearer:token123" \\
  -H "Authorization: Bearer token123"</code></pre>
  <details>
    <summary>Success Response (200)</summary>
    <pre><code>{
  "method": "GET",
  "path": "/echo",
  "headers": {
    "authorization": "Bearer token123",
    "x-reqback-auth": "bearer:token123"
  }
}</code></pre>
  </details>

  <h3>CORS Restriction</h3>
  <pre><code>curl https://reqback.fly.dev/echo \\
  -H "X-Reqback-CORS: origin:myapp.com"</code></pre>
  <details>
    <summary>Headers Include</summary>
    <pre><code>Access-Control-Allow-Origin: myapp.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD
Access-Control-Allow-Headers: *</code></pre>
  </details>

  <h3>Error Simulation</h3>
  <pre><code>curl https://reqback.fly.dev/echo \\
  -H "X-Reqback-Status: 404" \\
  -H "X-Reqback-Delay: 2"</code></pre>
  <details>
    <summary>Response (404, after 2s delay)</summary>
    <pre><code>{
  "method": "GET",
  "path": "/echo",
  "delayed": "2 seconds",
  "requestedStatus": 404
}</code></pre>
  </details>

  <h2>Features</h2>
  <ul>
    <li>Full CORS support with simulation</li>
    <li>All HTTP methods supported</li>
    <li>JSON, form data, and text body parsing</li>
    <li>Real IP detection (works behind proxies/CDNs)</li>
    <li>Authentication simulation (Bearer, Basic, Cookie, CSRF)</li>
    <li>CORS testing and restrictions</li>
    <li>Redirect handling and loops</li>
    <li>Cache control headers</li>
    <li>Content type overrides</li>
    <li>Status code and delay control</li>
    <li>No rate limiting</li>
    <li>Clean header-based control mechanism</li>
  </ul>

  <h2>Use Cases</h2>
  <ul>
    <li>Webhook testing and debugging</li>
    <li>HTTP client development</li>
    <li>CORS policy validation</li>
    <li>Authentication flow testing</li>
    <li>Frontend integration testing</li>
    <li>API error handling</li>
    <li>Loading state demonstrations</li>
    <li>HTTP fundamentals learning</li>
    <li>Redirect behavior testing</li>
    <li>Cache behavior validation</li>
  </ul>

  <footer>
    <p>Built with Shovel (Node.js Platform) • <a href="https://github.com/brainkim/reqback">Original on GitHub</a></p>
  </footer>
</body>
</html>`;

function getRequestInfo(req: Request): any {
  const url = new URL(req.url);
  const headers: Record<string, string> = {};

  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // Extract IP from various proxy headers
  const ip =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  return {
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers,
    ip,
    userAgent: req.headers.get("user-agent") || "unknown",
    timestamp: new Date().toISOString(),
    protocol: url.protocol.replace(":", ""),
    host: req.headers.get("host") || "unknown",
  };
}

async function parseBody(req: Request): Promise<any> {
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
      return await req.text();
    }
  } catch (e) {
    return null;
  }
}

function parseCorsHeader(corsHeader: string | null): Record<string, string> | null {
  if (!corsHeader) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
      "Access-Control-Allow-Headers": "*",
    };
  }

  // Check for block first
  if (corsHeader === "block") {
    return null; // No CORS headers
  }

  let headers: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
    "Access-Control-Allow-Headers": "*",
  };

  // Handle each parameter type separately to avoid comma conflicts
  if (corsHeader.includes("origin:")) {
    const match = corsHeader.match(/origin:([^,]+)/);
    if (match) {
      headers["Access-Control-Allow-Origin"] = match[1].trim();
    }
  }

  if (corsHeader.includes("methods:")) {
    const match = corsHeader.match(/methods:([^,]+(?:,[^:]+)*)/);
    if (match) {
      headers["Access-Control-Allow-Methods"] = match[1].trim();
    }
  }

  if (corsHeader.includes("headers:")) {
    const match = corsHeader.match(/headers:([^,]+(?:,[^:]+)*)/);
    if (match) {
      headers["Access-Control-Allow-Headers"] = match[1].trim();
    }
  }

  if (corsHeader.includes("credentials:")) {
    const match = corsHeader.match(/credentials:([^,]+)/);
    if (match) {
      headers["Access-Control-Allow-Credentials"] = match[1].trim();
    }
  }

  return headers;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
    "Access-Control-Allow-Headers": "*",
  };
}

function handleAuthSimulation(req: Request, authHeader: string): { status: number; body: string } | null {
  const authParams = authHeader.split(",").map(p => p.trim());

  for (const param of authParams) {
    if (param === "unauthorized" || param === "401") {
      return {
        status: 401,
        body: JSON.stringify({
          error: "Unauthorized",
          message: "Authentication required",
          authType: "simulation"
        }),
      };
    }

    if (param === "forbidden" || param === "403") {
      return {
        status: 403,
        body: JSON.stringify({
          error: "Forbidden",
          message: "Access denied",
          authType: "simulation"
        }),
      };
    }

    if (param === "expired") {
      return {
        status: 401,
        body: JSON.stringify({
          error: "Token Expired",
          message: "Your authentication token has expired",
          authType: "simulation"
        }),
      };
    }

    if (param.startsWith("bearer:")) {
      const expectedToken = param.split(":")[1];
      const authHeader = req.headers.get("authorization");
      const providedToken = authHeader?.replace("Bearer ", "");

      if (providedToken !== expectedToken) {
        return {
          status: 401,
          body: JSON.stringify({
            error: "Invalid Bearer Token",
            message: `Expected token: ${expectedToken}`,
            provided: providedToken || "none",
            authType: "bearer"
          }),
        };
      }
    }

    if (param.startsWith("basic:")) {
      const [, expectedUser, expectedPass] = param.split(":");
      const authHeader = req.headers.get("authorization");

      if (!authHeader?.startsWith("Basic ")) {
        return {
          status: 401,
          body: JSON.stringify({
            error: "Basic Authentication Required",
            message: `Expected user:${expectedUser} pass:${expectedPass}`,
            authType: "basic"
          }),
        };
      }

      const base64Creds = authHeader.replace("Basic ", "");
      const [providedUser, providedPass] = atob(base64Creds).split(":");

      if (providedUser !== expectedUser || providedPass !== expectedPass) {
        return {
          status: 401,
          body: JSON.stringify({
            error: "Invalid Credentials",
            message: `Expected user:${expectedUser} pass:${expectedPass}`,
            provided: `user:${providedUser} pass:${providedPass}`,
            authType: "basic"
          }),
        };
      }
    }

    if (param.startsWith("cookie:")) {
      const expectedValue = param.split(":")[1];
      const cookieHeader = req.headers.get("cookie");

      if (!cookieHeader?.includes(`session=${expectedValue}`)) {
        return {
          status: 401,
          body: JSON.stringify({
            error: "Invalid Session Cookie",
            message: `Expected session=${expectedValue}`,
            provided: cookieHeader || "none",
            authType: "cookie"
          }),
        };
      }
    }

    if (param === "csrf") {
      const csrfToken = req.headers.get("x-csrf-token");

      if (!csrfToken) {
        return {
          status: 403,
          body: JSON.stringify({
            error: "CSRF Token Required",
            message: "Missing X-CSRF-Token header",
            authType: "csrf"
          }),
        };
      }
    }
  }

  return null; // Authentication passed
}

function handleRedirectSimulation(redirectHeader: string): { status: number; location: string } | null {
  if (redirectHeader === "loop") {
    return {
      status: 302,
      location: "/echo", // Redirect to itself to create a loop
    };
  }

  if (redirectHeader.includes(":")) {
    const colonIndex = redirectHeader.indexOf(":");
    const statusStr = redirectHeader.substring(0, colonIndex);
    const location = redirectHeader.substring(colonIndex + 1);
    const status = parseInt(statusStr);

    if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308) && location) {
      return {
        status,
        location: location.trim(),
      };
    }
  }

  return null;
}

function handleCacheSimulation(cacheHeader: string | null): Record<string, string> {
  if (!cacheHeader) return {};

  const cacheParams = cacheHeader.split(",").map(p => p.trim());
  const headers: Record<string, string> = {};

  for (const param of cacheParams) {
    if (param === "no-cache") {
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
      headers["Pragma"] = "no-cache";
      headers["Expires"] = "0";
    } else if (param.startsWith("max-age:")) {
      const maxAge = param.split(":")[1];
      headers["Cache-Control"] = `max-age=${maxAge}`;
    } else if (param.startsWith("etag:")) {
      const etag = param.split(":")[1];
      headers["ETag"] = `"${etag}"`;
    }
  }

  return headers;
}


async function handleApiRequest(req: Request): Promise<Response> {
  const corsHeader = req.headers.get("x-reqback-cors");

  // Handle preflight
  if (req.method === "OPTIONS") {
    const corsHeadersToUse = parseCorsHeader(corsHeader);

    if (!corsHeadersToUse) {
      // CORS blocked - no headers
      return new Response(null, { status: 204 });
    }

    return new Response(null, {
      status: 204,
      headers: corsHeadersToUse,
    });
  }

  // Check for auth simulation first
  const authHeader = req.headers.get("x-reqback-auth");
  if (authHeader) {
    const authResponse = handleAuthSimulation(req, authHeader);
    if (authResponse) {
      const corsHeadersToUse = parseCorsHeader(corsHeader);
      return new Response(authResponse.body, {
        status: authResponse.status,
        headers: {
          "Content-Type": "application/json",
          ...(corsHeadersToUse || {}),
        },
      });
    }
  }

  // Check for redirect simulation
  const redirectHeader = req.headers.get("x-reqback-redirect");
  if (redirectHeader) {
    const redirectResponse = handleRedirectSimulation(redirectHeader);
    if (redirectResponse) {
      const corsHeadersToUse = parseCorsHeader(corsHeader);
      return new Response(null, {
        status: redirectResponse.status,
        headers: {
          "Location": redirectResponse.location,
          ...(corsHeadersToUse || {}),
        },
      });
    }
  }

  // Get request info
  const info = getRequestInfo(req);
  const body = await parseBody(req);

  // Check for control headers
  const delayHeader = req.headers.get("x-reqback-delay");
  const statusHeader = req.headers.get("x-reqback-status");

  let delay = 0;
  let statusCode = 200;

  // Parse delay
  if (delayHeader) {
    const parsedDelay = parseInt(delayHeader);
    if (isNaN(parsedDelay) || parsedDelay < 1 || parsedDelay > 10) {
      return Response.json(
        { error: "X-Reqback-Delay must be between 1 and 10" },
        { status: 400, headers: corsHeaders() }
      );
    }
    delay = parsedDelay;
  }

  // Parse status code
  if (statusHeader) {
    const parsedStatus = parseInt(statusHeader);
    if (isNaN(parsedStatus) || parsedStatus < 100 || parsedStatus > 599) {
      return Response.json(
        { error: "X-Reqback-Status must be between 100 and 599" },
        { status: 400, headers: corsHeaders() }
      );
    }
    statusCode = parsedStatus;
  }

  // Apply delay if requested
  if (delay > 0) {
    await new Promise(resolve => setTimeout(resolve, delay * 1000));
  }

  // Build response
  const response: any = {
    ...info,
    body,
    contentType: req.headers.get("content-type") || null,
  };

  // Add metadata about control headers if used
  if (delay > 0) {
    response.delayed = `${delay} seconds`;
  }
  if (statusCode !== 200) {
    response.requestedStatus = statusCode;
  }

  const corsHeadersToUse = parseCorsHeader(corsHeader);
  const cacheHeader = req.headers.get("x-reqback-cache");
  const cacheHeaders = handleCacheSimulation(cacheHeader);
  const contentTypeHeader = req.headers.get("x-reqback-content-type");

  const responseHeaders = {
    ...(corsHeadersToUse || {}),
    ...cacheHeaders,
  };

  // Override content type if specified
  if (contentTypeHeader) {
    responseHeaders["Content-Type"] = contentTypeHeader;
  } else {
    responseHeaders["Content-Type"] = "application/json";
  }

  return Response.json(response, {
    status: statusCode,
    headers: responseHeaders,
  });
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Homepage
  if (url.pathname === "/" || url.pathname === "") {
    return new Response(HOMEPAGE_HTML, {
      headers: { "Content-Type": "text/html" },
    });
  }

  // API endpoint
  if (url.pathname === "/echo" || url.pathname === "/echo/") {
    return handleApiRequest(req);
  }

  // 404
  return Response.json(
    {
      error: "Not found",
      path: url.pathname,
      suggestion: "Try /echo or see / for documentation",
    },
    {
      status: 404,
      headers: corsHeaders(),
    }
  );
}

// Export handler and helper functions for Shovel integration
export {
	handleRequest,
	getRequestInfo,
	parseBody,
	parseCorsHeader,
	handleAuthSimulation,
	handleRedirectSimulation,
	handleCacheSimulation,
	HOMEPAGE_HTML
};
