#!/usr/bin/env sh
//bin/true; exec "$([ "${npm_config_user_agent#bun/}" != "$npm_config_user_agent" ] && echo bun || echo node)" "$0" "$@"
/* eslint-disable no-console -- CLI app uses console for terminal output */

import {intro, outro, text, select, confirm, spinner} from "@clack/prompts";
import {mkdir, writeFile} from "fs/promises";
import {join, resolve} from "path";
import {existsSync} from "fs";

interface ProjectConfig {
	name: string;
	platform: "node" | "bun" | "cloudflare";
	template: "hello-world" | "api" | "static-site" | "full-stack";
	typescript: boolean;
}

/**
 * Auto-detect the best default platform based on the runtime environment.
 */
function detectPlatform(): "node" | "bun" {
	// Check if running under Bun
	// eslint-disable-next-line no-restricted-properties -- CLI needs to check runtime environment
	if (process.env.npm_config_user_agent?.includes("bun")) {
		return "bun";
	}
	// Default to Node.js
	return "node";
}

function validateProjectName(name: string): string | undefined {
	if (!name) return "Project name is required";
	if (!/^[a-z0-9-]+$/.test(name))
		return "Use lowercase letters, numbers, and hyphens only";
	return undefined;
}

async function main() {
	console.info("");

	intro("Create Shovel App");

	// Get project name from args or prompt
	let projectName = process.argv[2];

	if (projectName) {
		// Validate CLI argument the same way as interactive input
		const validationError = validateProjectName(projectName);
		if (validationError) {
			console.error(`Error: ${validationError}`);
			process.exit(1);
		}
	} else {
		const nameResult = await text({
			message: "What is your project name?",
			placeholder: "my-shovel-app",
			validate: validateProjectName,
		});

		if (typeof nameResult === "symbol") {
			outro("Project creation cancelled");
			process.exit(0);
		}

		projectName = nameResult;
	}

	// eslint-disable-next-line no-restricted-properties -- CLI needs cwd for project creation
	const projectPath = resolve(process.cwd(), projectName);

	// Check if directory exists
	if (existsSync(projectPath)) {
		const overwrite = await confirm({
			message: `Directory "${projectName}" already exists. Overwrite?`,
		});

		if (typeof overwrite === "symbol" || !overwrite) {
			outro("Project creation cancelled");
			process.exit(0);
		}
	}

	// 1. Template selection (most important question first)
	const template = await select({
		message: "Choose a starter template:",
		options: [
			{
				value: "hello-world" as const,
				label: "Hello World",
				hint: "Minimal fetch handler to get started",
			},
			{
				value: "api" as const,
				label: "API",
				hint: "REST endpoints with JSON responses",
			},
			{
				value: "static-site" as const,
				label: "Static Site",
				hint: "Serve files from public/ directory",
			},
			{
				value: "full-stack" as const,
				label: "Full Stack",
				hint: "HTML pages + API routes + static assets",
			},
		],
	});

	if (typeof template === "symbol") {
		outro("Project creation cancelled");
		process.exit(0);
	}

	// 2. TypeScript option (default to yes)
	const typescript = await confirm({
		message: "Use TypeScript?",
		initialValue: true,
	});

	if (typeof typescript === "symbol") {
		outro("Project creation cancelled");
		process.exit(0);
	}

	// 3. Platform selection (last, with auto-detected default)
	const detectedPlatform = detectPlatform();
	const platform = await select({
		message: "Which platform?",
		initialValue: detectedPlatform,
		options: [
			{
				value: "node" as const,
				label: "Node.js",
				hint: detectedPlatform === "node" ? "detected" : undefined,
			},
			{
				value: "bun" as const,
				label: "Bun",
				hint: detectedPlatform === "bun" ? "detected" : undefined,
			},
			{
				value: "cloudflare" as const,
				label: "Cloudflare Workers",
				hint: "Edge runtime",
			},
		],
	});

	if (typeof platform === "symbol") {
		outro("Project creation cancelled");
		process.exit(0);
	}

	const config: ProjectConfig = {
		name: projectName,
		platform,
		template,
		typescript,
	};

	// Create project
	const s = spinner();
	s.start("Creating your Shovel project...");

	try {
		await createProject(config, projectPath);
		s.stop("Project created");

		console.info("");
		outro("Your Shovel project is ready!");

		console.info("");
		console.info("Next steps:");
		console.info(`  cd ${projectName}`);
		console.info(`  npm install`);
		console.info(`  npm run dev`);
		console.info("");
		console.info("Your app will be available at: http://localhost:7777");
		console.info("");
	} catch (error) {
		s.stop("Failed to create project");
		console.error("Error:", error);
		process.exit(1);
	}
}

async function createProject(config: ProjectConfig, projectPath: string) {
	// Create project directory
	await mkdir(projectPath, {recursive: true});
	await mkdir(join(projectPath, "src"), {recursive: true});

	// Create public directory for static-site and full-stack templates
	if (config.template === "static-site" || config.template === "full-stack") {
		await mkdir(join(projectPath, "public"), {recursive: true});
	}

	// Create package.json
	const ext = config.typescript ? "ts" : "js";
	const packageJson = {
		name: config.name,
		private: true,
		version: "0.0.1",
		type: "module",
		scripts: {
			dev: `shovel develop src/app.${ext} --platform ${config.platform}`,
			build: `shovel build src/app.${ext} --platform ${config.platform}`,
			start: "node dist/server/supervisor.js",
		},
		dependencies: {
			"@b9g/router": "^0.2.0",
			"@b9g/shovel": "^0.2.0",
			"@b9g/filesystem": "^0.1.8",
			"@b9g/cache": "^0.2.0",
		},
		devDependencies: config.typescript
			? {
					"@types/node": "^18.0.0",
					typescript: "^5.0.0",
				}
			: {},
	};

	await writeFile(
		join(projectPath, "package.json"),
		JSON.stringify(packageJson, null, 2),
	);

	// Create app file
	const appFile = generateAppFile(config);
	await writeFile(join(projectPath, `src/app.${ext}`), appFile);

	// Create TypeScript config if needed
	if (config.typescript) {
		const tsConfig = {
			compilerOptions: {
				target: "ES2022",
				module: "ESNext",
				moduleResolution: "bundler",
				allowSyntheticDefaultImports: true,
				esModuleInterop: true,
				strict: true,
				skipLibCheck: true,
				forceConsistentCasingInFileNames: true,
				lib: ["ES2022", "WebWorker"],
			},
			include: ["src/**/*"],
			exclude: ["node_modules", "dist"],
		};

		await writeFile(
			join(projectPath, "tsconfig.json"),
			JSON.stringify(tsConfig, null, 2),
		);
	}

	// Create static files for templates that need them
	if (config.template === "static-site" || config.template === "full-stack") {
		await createStaticFiles(config, projectPath);
	}

	// Create README
	const readme = generateReadme(config);
	await writeFile(join(projectPath, "README.md"), readme);

	// Create .gitignore
	const gitignore = `node_modules/
dist/
.env
.env.local
*.log
.DS_Store
`;
	await writeFile(join(projectPath, ".gitignore"), gitignore);
}

async function createStaticFiles(config: ProjectConfig, projectPath: string) {
	// Create index.html
	const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.name}</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main>
    <h1>Welcome to ${config.name}</h1>
    <p>Edit <code>public/index.html</code> to get started.</p>
    ${config.template === "full-stack" ? '<p>API endpoint: <a href="/api/hello">/api/hello</a></p>' : ""}
  </main>
</body>
</html>
`;
	await writeFile(join(projectPath, "public/index.html"), indexHtml);

	// Create styles.css
	const stylesCss = `* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  line-height: 1.6;
  color: #333;
  background: #fafafa;
}

main {
  max-width: 640px;
  margin: 4rem auto;
  padding: 2rem;
}

h1 {
  color: #2563eb;
  margin-bottom: 1rem;
}

code {
  background: #e5e7eb;
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  font-size: 0.9em;
}

a {
  color: #2563eb;
}
`;
	await writeFile(join(projectPath, "public/styles.css"), stylesCss);
}

function generateAppFile(config: ProjectConfig): string {
	switch (config.template) {
		case "hello-world":
			return generateHelloWorld(config);
		case "api":
			return generateApi(config);
		case "static-site":
			return generateStaticSite(config);
		case "full-stack":
			return generateFullStack(config);
		default:
			return generateHelloWorld(config);
	}
}

function generateHelloWorld(config: ProjectConfig): string {
	return `// ${config.name} - Hello World
self.addEventListener("fetch", (event) => {
  event.respondWith(
    new Response("Hello from Shovel!", {
      headers: { "Content-Type": "text/plain" },
    })
  );
});
`;
}

function generateApi(config: ProjectConfig): string {
	return `import { Router } from "@b9g/router";

const router = new Router();

// In-memory data store
const users = [
  { id: 1, name: "Alice", email: "alice@example.com" },
  { id: 2, name: "Bob", email: "bob@example.com" },
];

// List all users
router.route("/api/users").get(() => {
  return Response.json({ users });
});

// Get user by ID
router.route("/api/users/:id").get((req, ctx) => {
  const user = users.find((u) => u.id === Number(ctx.params.id));
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }
  return Response.json({ user });
});

// Create user
router.route("/api/users").post(async (req) => {
  const body = await req.json();
  const user = {
    id: users.length + 1,
    name: body.name,
    email: body.email,
  };
  users.push(user);
  return Response.json({ user }, { status: 201 });
});

// Health check
router.route("/health").get(() => {
  return Response.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Root - API info
router.route("/").get(() => {
  return Response.json({
    name: "${config.name}",
    endpoints: [
      "GET /api/users",
      "GET /api/users/:id",
      "POST /api/users",
      "GET /health",
    ],
  });
});

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
`;
}

function generateStaticSite(config: ProjectConfig): string {
	return `// ${config.name} - Static Site
// Serves files from the public/ directory

self.addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request${config.typescript ? ": Request" : ""})${config.typescript ? ": Promise<Response>" : ""} {
  const url = new URL(request.url);
  let path = url.pathname;

  // Default to index.html for root
  if (path === "/") {
    path = "/index.html";
  }

  // Try to serve from public directory
  try {
    const publicDir = await directories.open("public");
    const file = await publicDir.getFileHandle(path.slice(1)); // Remove leading /
    const blob = await file.getFile();

    return new Response(blob, {
      headers: {
        "Content-Type": getContentType(path),
      },
    });
  } catch {
    // File not found - return 404
    return new Response("Not Found", { status: 404 });
  }
}

function getContentType(path${config.typescript ? ": string" : ""})${config.typescript ? ": string" : ""} {
  const ext = path.split(".").pop()?.toLowerCase();
  const types${config.typescript ? ": Record<string, string>" : ""} = {
    html: "text/html",
    css: "text/css",
    js: "text/javascript",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    ico: "image/x-icon",
  };
  return types[ext || ""] || "application/octet-stream";
}
`;
}

function generateFullStack(config: ProjectConfig): string {
	return `import { Router } from "@b9g/router";

const router = new Router();

// API routes
router.route("/api/hello").get(() => {
  return Response.json({
    message: "Hello from the API!",
    timestamp: new Date().toISOString(),
  });
});

router.route("/api/echo").post(async (req) => {
  const body = await req.json();
  return Response.json({ echo: body });
});

// Serve static files from public/ for all other routes
router.route("/*").get(async (req, ctx) => {
  const url = new URL(req.url);
  let path = url.pathname;

  // Default to index.html for root
  if (path === "/") {
    path = "/index.html";
  }

  try {
    const publicDir = await directories.open("public");
    const file = await publicDir.getFileHandle(path.slice(1));
    const blob = await file.getFile();

    return new Response(blob, {
      headers: {
        "Content-Type": getContentType(path),
      },
    });
  } catch {
    // Try index.html for SPA routing
    try {
      const publicDir = await directories.open("public");
      const file = await publicDir.getFileHandle("index.html");
      const blob = await file.getFile();
      return new Response(blob, {
        headers: { "Content-Type": "text/html" },
      });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  }
});

function getContentType(path${config.typescript ? ": string" : ""})${config.typescript ? ": string" : ""} {
  const ext = path.split(".").pop()?.toLowerCase();
  const types${config.typescript ? ": Record<string, string>" : ""} = {
    html: "text/html",
    css: "text/css",
    js: "text/javascript",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    ico: "image/x-icon",
  };
  return types[ext || ""] || "application/octet-stream";
}

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
`;
}

function generateReadme(config: ProjectConfig): string {
	const templateDescriptions: Record<string, string> = {
		"hello-world": "A minimal Shovel application",
		api: "A REST API with JSON endpoints",
		"static-site": "A static file server",
		"full-stack": "A full-stack app with API routes and static files",
	};

	return `# ${config.name}

${templateDescriptions[config.template]}, built with [Shovel](https://github.com/bikeshaving/shovel).

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

Open http://localhost:7777

## Scripts

- \`npm run dev\` - Start development server
- \`npm run build\` - Build for production
- \`npm start\` - Run production build

## Project Structure

\`\`\`
${config.name}/
├── src/
│   └── app.${config.typescript ? "ts" : "js"}    # Application entry point
${config.template === "static-site" || config.template === "full-stack" ? "├── public/           # Static files\n│   ├── index.html\n│   └── styles.css\n" : ""}├── package.json
${config.typescript ? "├── tsconfig.json\n" : ""}└── README.md
\`\`\`

## Learn More

- [Shovel Documentation](https://github.com/bikeshaving/shovel)
- [ServiceWorker API](https://developer.mozilla.org/docs/Web/API/Service_Worker_API)
`;
}

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
	outro("Project creation cancelled");
	process.exit(0);
});

main().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
