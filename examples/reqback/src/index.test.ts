import { describe, expect, test, beforeAll, afterAll } from "bun:test";

const BASE_URL = "http://localhost:3001";
let server: any;

beforeAll(async () => {
  // Import and start the server on a different port for testing
  const { handleRequest } = await import("./index.ts");
  server = Bun.serve({
    port: 3001,
    fetch: handleRequest,
  });
});

afterAll(() => {
  if (server) {
    server.stop();
  }
});

describe("Basic functionality", () => {
  test("homepage returns HTML", async () => {
    const response = await fetch(BASE_URL);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    const text = await response.text();
    expect(text).toContain("reqback");
    expect(text).toContain("/echo");
  });

  test("/echo returns request info", async () => {
    const response = await fetch(`${BASE_URL}/echo`);
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.method).toBe("GET");
    expect(data.path).toBe("/echo");
    expect(data.headers).toBeDefined();
    expect(data.timestamp).toBeDefined();
  });

  test("POST with JSON body", async () => {
    const testData = { hello: "world", test: true };
    const response = await fetch(`${BASE_URL}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testData),
    });
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.method).toBe("POST");
    expect(data.body).toEqual(testData);
    expect(data.contentType).toBe("application/json");
  });

  test("404 for unknown paths", async () => {
    const response = await fetch(`${BASE_URL}/unknown`);
    expect(response.status).toBe(404);
    
    const data = await response.json();
    expect(data.error).toBe("Not found");
    expect(data.suggestion).toContain("/echo");
  });
});

describe("X-Reqback-Delay", () => {
  test("delays response by specified seconds", async () => {
    const start = Date.now();
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-Delay": "1" },
    });
    const elapsed = Date.now() - start;
    
    expect(response.status).toBe(200);
    expect(elapsed).toBeGreaterThan(950); // Allow some margin
    
    const data = await response.json();
    expect(data.delayed).toBe("1 seconds");
  });

  test("rejects invalid delay values", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-Delay": "15" },
    });
    
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("between 1 and 10");
  });
});

describe("X-Reqback-Status", () => {
  test("returns custom status code", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-Status": "201" },
    });
    
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.requestedStatus).toBe(201);
  });

  test("handles error status codes", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-Status": "500" },
    });
    
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.requestedStatus).toBe(500);
  });

  test("rejects invalid status codes", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-Status": "999" },
    });
    
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("between 100 and 599");
  });
});

describe("CORS", () => {
  test("OPTIONS request returns CORS headers", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      method: "OPTIONS",
    });
    
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
    expect(response.headers.get("access-control-allow-headers")).toBe("*");
  });

  test("all responses include CORS headers", async () => {
    const response = await fetch(`${BASE_URL}/echo`);
    
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
  });
});

describe("X-Reqback-CORS", () => {
  test("blocks CORS entirely", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-CORS": "block" },
    });
    
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("restricts origin", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-CORS": "origin:example.com" },
    });
    
    expect(response.headers.get("access-control-allow-origin")).toBe("example.com");
  });

  test("limits methods", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-CORS": "methods:GET,POST" },
    });
    
    expect(response.headers.get("access-control-allow-methods")).toBe("GET,POST");
  });

  test("OPTIONS preflight with CORS block", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      method: "OPTIONS",
      headers: { "X-Reqback-CORS": "block" },
    });
    
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("X-Reqback-Auth", () => {
  test("requires authentication", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-Auth": "unauthorized" },
    });
    
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  test("forbidden access", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-Auth": "forbidden" },
    });
    
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Forbidden");
  });

  test("validates bearer token - success", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: {
        "X-Reqback-Auth": "bearer:secret123",
        "Authorization": "Bearer secret123",
      },
    });
    
    expect(response.status).toBe(200);
  });

  test("validates bearer token - failure", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: {
        "X-Reqback-Auth": "bearer:secret123",
        "Authorization": "Bearer wrong-token",
      },
    });
    
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Invalid Bearer Token");
  });

  test("validates basic auth - success", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: {
        "X-Reqback-Auth": "basic:user:pass",
        "Authorization": "Basic " + btoa("user:pass"),
      },
    });
    
    expect(response.status).toBe(200);
  });

  test("validates cookie auth", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: {
        "X-Reqback-Auth": "cookie:abc123",
        "Cookie": "session=abc123",
      },
    });
    
    expect(response.status).toBe(200);
  });

  test("requires CSRF token", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-Auth": "csrf" },
    });
    
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("CSRF Token Required");
  });
});

describe("X-Reqback-Redirect", () => {
  test("permanent redirect", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-Redirect": "301:https://example.com" },
      redirect: "manual",
    });
    
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://example.com");
  });

  test("temporary redirect", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-Redirect": "302:/echo" },
      redirect: "manual",
    });
    
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/echo");
  });

  test("redirect loop", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-Redirect": "loop" },
      redirect: "manual",
    });
    
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/echo");
  });
});

describe("X-Reqback-Cache", () => {
  test("no-cache headers", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-Cache": "no-cache" },
    });
    
    expect(response.headers.get("cache-control")).toBe("no-cache, no-store, must-revalidate");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
  });

  test("max-age cache control", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-Cache": "max-age:3600" },
    });
    
    expect(response.headers.get("cache-control")).toBe("max-age=3600");
  });

  test("etag header", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-Cache": "etag:abc123" },
    });
    
    expect(response.headers.get("etag")).toBe('"abc123"');
  });
});

describe("X-Reqback-Content-Type", () => {
  test("overrides content type to XML", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-Content-Type": "application/xml" },
    });
    
    expect(response.headers.get("content-type")).toBe("application/xml");
  });

  test("overrides content type to plain text", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: { "X-Reqback-Content-Type": "text/plain" },
    });
    
    expect(response.headers.get("content-type")).toBe("text/plain");
  });
});

describe("Combined headers", () => {
  test("delay and status work together", async () => {
    const start = Date.now();
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: {
        "X-Reqback-Delay": "1",
        "X-Reqback-Status": "202",
      },
    });
    const elapsed = Date.now() - start;
    
    expect(response.status).toBe(202);
    expect(elapsed).toBeGreaterThan(950);
    
    const data = await response.json();
    expect(data.delayed).toBe("1 seconds");
    expect(data.requestedStatus).toBe(202);
  });

  test("complex combination: auth + CORS + cache", async () => {
    const response = await fetch(`${BASE_URL}/echo`, {
      headers: {
        "X-Reqback-Auth": "bearer:token123",
        "X-Reqback-CORS": "origin:myapp.com",
        "X-Reqback-Cache": "max-age:1800",
        "Authorization": "Bearer token123",
      },
    });
    
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("myapp.com");
    expect(response.headers.get("cache-control")).toBe("max-age=1800");
  });
});