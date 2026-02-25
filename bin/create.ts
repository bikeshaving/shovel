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
	uiFramework: "vanilla" | "htmx" | "alpine" | "crank";
	useJSX: boolean;
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

/**
 * Parse CLI flags from process.argv.
 *
 * Supports:
 *   --template <name>       Skip template prompt
 *   --framework <name>      Skip UI framework prompt (vanilla, htmx, alpine, crank)
 *   --typescript             Skip TypeScript prompt (yes)
 *   --no-typescript          Skip TypeScript prompt (no)
 *   --jsx / --no-jsx         Skip JSX prompt (Crank only)
 *   --platform <name>       Skip platform prompt
 */
function parseFlags(args: string[]): {
	template?: string;
	framework?: string;
	typescript?: boolean;
	jsx?: boolean;
	platform?: string;
} {
	const flags: Record<string, string | boolean> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--template" && args[i + 1]) flags.template = args[++i];
		else if (arg === "--framework" && args[i + 1]) flags.framework = args[++i];
		else if (arg === "--typescript") flags.typescript = true;
		else if (arg === "--no-typescript") flags.typescript = false;
		else if (arg === "--jsx") flags.jsx = true;
		else if (arg === "--no-jsx") flags.jsx = false;
		else if (arg === "--platform" && args[i + 1]) flags.platform = args[++i];
	}
	return flags;
}

async function main() {
	console.info("");

	intro("Create Shovel App");

	const flags = parseFlags(process.argv.slice(2));

	// Get project name from args or prompt (skip --flags)
	let projectName = process.argv[2]?.startsWith("-")
		? undefined
		: process.argv[2];

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
	let template: ProjectConfig["template"];
	let uiFramework: ProjectConfig["uiFramework"] = "vanilla";

	if (flags.template) {
		const valid = ["hello-world", "api", "static-site", "full-stack"];
		if (!valid.includes(flags.template)) {
			console.error(
				`Error: Unknown template "${flags.template}". Valid options: ${valid.join(", ")}`,
			);
			process.exit(1);
		}
		template = flags.template as ProjectConfig["template"];
	} else {
		const templateResult = await select({
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
					hint: "Server-rendered HTML pages",
				},
				{
					value: "full-stack" as const,
					label: "Full Stack",
					hint: "HTML pages + API routes",
				},
			],
		});

		if (typeof templateResult === "symbol") {
			outro("Project creation cancelled");
			process.exit(0);
		}
		template = templateResult;
	}

	// 2. UI framework (only for HTML-serving templates)
	if (template === "static-site" || template === "full-stack") {
		if (flags.framework) {
			const valid = ["vanilla", "htmx", "alpine", "crank"];
			if (!valid.includes(flags.framework)) {
				console.error(
					`Error: Unknown framework "${flags.framework}". Valid options: ${valid.join(", ")}`,
				);
				process.exit(1);
			}
			uiFramework = flags.framework as ProjectConfig["uiFramework"];
		} else {
			const framework = await select({
				message: "UI framework:",
				initialValue: "crank" as ProjectConfig["uiFramework"],
				options: [
					{
						value: "alpine" as const,
						label: "Alpine.js",
						hint: "Lightweight reactivity with x-data directives",
					},
					{
						value: "crank" as const,
						label: "Crank.js",
						hint: "JSX components with server rendering and hydration",
					},
					{
						value: "htmx" as const,
						label: "HTMX",
						hint: "HTML-driven interactions with hx- attributes",
					},
					{
						value: "vanilla" as const,
						label: "Vanilla",
						hint: "Plain HTML, no framework",
					},
				],
			});

			if (typeof framework === "symbol") {
				outro("Project creation cancelled");
				process.exit(0);
			}

			uiFramework = framework;
		}
	}

	// 2b. JSX preference (only for Crank)
	let useJSX = true;
	if (uiFramework === "crank") {
		if (flags.jsx !== undefined) {
			useJSX = flags.jsx;
		} else {
			const jsxResult = await confirm({
				message: "Use JSX?",
				initialValue: true,
			});

			if (typeof jsxResult === "symbol") {
				outro("Project creation cancelled");
				process.exit(0);
			}
			useJSX = jsxResult;
		}
	}

	// 3. TypeScript (default to yes)
	let typescript: boolean;
	if (flags.typescript !== undefined) {
		typescript = flags.typescript;
	} else {
		const tsResult = await confirm({
			message: "Use TypeScript?",
			initialValue: true,
		});

		if (typeof tsResult === "symbol") {
			outro("Project creation cancelled");
			process.exit(0);
		}
		typescript = tsResult;
	}

	// 4. Platform (last, with auto-detected default)
	let platform: ProjectConfig["platform"];
	if (flags.platform) {
		const valid = ["node", "bun", "cloudflare"];
		if (!valid.includes(flags.platform)) {
			console.error(
				`Error: Unknown platform "${flags.platform}". Valid options: ${valid.join(", ")}`,
			);
			process.exit(1);
		}
		platform = flags.platform as ProjectConfig["platform"];
	} else {
		const detectedPlatform = detectPlatform();
		const platformResult = await select({
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

		if (typeof platformResult === "symbol") {
			outro("Project creation cancelled");
			process.exit(0);
		}
		platform = platformResult;
	}

	const config: ProjectConfig = {
		name: projectName,
		platform,
		template,
		typescript,
		uiFramework,
		useJSX,
	};

	// Create project
	const s = spinner();
	s.start("Creating your Shovel project...");

	try {
		await createProject(config, projectPath);
		s.stop("Project created");

		console.info("");
		outro("Your project is shovel-ready!");

		const pm = platform === "bun" ? "bun" : "npm";
		console.info("");
		console.info("Next steps:");
		console.info(`  cd ${projectName}`);
		console.info(`  ${pm} install`);
		console.info(`  ${pm} run develop`);
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

	// Create package.json
	const ext =
		config.uiFramework === "crank" && config.useJSX
			? config.typescript
				? "tsx"
				: "jsx"
			: config.typescript
				? "ts"
				: "js";
	const isCrank = config.uiFramework === "crank";
	const hasClientBundle =
		config.template === "static-site" || config.template === "full-stack";
	const entryFile = hasClientBundle ? `src/server.${ext}` : `src/app.${ext}`;
	const startCmd =
		config.platform === "bun"
			? "bun dist/server/supervisor.js"
			: "node dist/server/supervisor.js";
	const dependencies: Record<string, string> = {
		"@b9g/router": "^0.2.0",
		"@b9g/shovel": "^0.2.0",
	};
	if (hasClientBundle) {
		dependencies["@b9g/assets"] = "^0.2.0";
	}
	if (isCrank) {
		dependencies["@b9g/crank"] = "^0.7.2";
	}
	if (config.uiFramework === "htmx") {
		dependencies["htmx.org"] = "^2.0.0";
	}
	if (config.uiFramework === "alpine") {
		dependencies["alpinejs"] = "^3.14.0";
	}
	const devDependencies: Record<string, string> = {};
	if (config.typescript) {
		devDependencies["@types/node"] = "^18.0.0";
		devDependencies["typescript"] = "^5.0.0";
	}
	if (hasClientBundle) {
		devDependencies["eslint"] = "^10.0.0";
		devDependencies["@eslint/js"] = "^10.0.0";
		if (config.typescript) {
			devDependencies["typescript-eslint"] = "^8.0.0";
		}
	}
	const scripts: Record<string, string> = {
		develop: `shovel develop ${entryFile} --platform ${config.platform}`,
		build: `shovel build ${entryFile} --platform ${config.platform}`,
		start: startCmd,
	};
	if (hasClientBundle) {
		scripts.lint = "eslint src/";
	}
	const packageJSON = {
		name: config.name,
		private: true,
		version: "0.1.0",
		type: "module",
		scripts,
		dependencies,
		devDependencies,
	};

	await writeFile(
		join(projectPath, "package.json"),
		JSON.stringify(packageJSON, null, 2),
	);

	// Create app file(s)
	const appResult = generateAppFile(config);
	if (typeof appResult === "string") {
		await writeFile(join(projectPath, `src/app.${ext}`), appResult);
	} else {
		for (const [filename, content] of Object.entries(appResult)) {
			await writeFile(join(projectPath, `src/${filename}`), content);
		}
	}

	// Create TypeScript config and declarations if needed
	if (config.typescript) {
		const compilerOptions: Record<string, unknown> = {
			target: "ES2022",
			module: "ESNext",
			moduleResolution: "bundler",
			allowSyntheticDefaultImports: true,
			esModuleInterop: true,
			strict: true,
			skipLibCheck: true,
			noEmit: true,
			allowImportingTsExtensions: true,
			forceConsistentCasingInFileNames: true,
			lib: ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
		};
		if (config.uiFramework === "crank" && config.useJSX) {
			compilerOptions.jsx = "react-jsx";
			compilerOptions.jsxImportSource = "@b9g/crank";
		}
		const tsConfig = {
			compilerOptions,
			include: [
				"src/**/*",
				"node_modules/@b9g/platform/src/globals.d.ts",
				"dist/server/shovel.d.ts",
			],
			exclude: [],
		};

		await writeFile(
			join(projectPath, "tsconfig.json"),
			JSON.stringify(tsConfig, null, 2),
		);
	}

	// Create ESLint config
	if (hasClientBundle) {
		let eslintConfig: string;
		if (config.typescript) {
			eslintConfig = `import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  tseslint.configs.recommended,
  { ignores: ["dist/"] },
);
`;
		} else {
			eslintConfig = `import js from "@eslint/js";

export default [
  js.configs.recommended,
  { ignores: ["dist/"] },
];
`;
		}
		await writeFile(join(projectPath, "eslint.config.js"), eslintConfig);
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

function generateAppFile(
	config: ProjectConfig,
): string | Record<string, string> {
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
	return `import {Router} from "@b9g/router";
import {logger} from "@b9g/router/middleware";

const router = new Router();
router.use(logger());

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

// Common CSS used across templates
const css = `    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; color: #333; background: #fafafa; }
    main { max-width: 640px; margin: 4rem auto; padding: 2rem; }
    h1 { color: #2563eb; margin-bottom: 1rem; }
    main > * + * { margin-top: 1rem; }
    code { background: #e5e7eb; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9em; }
    a { color: #2563eb; }
    ul { padding-left: 1.5rem; }
    li { margin-bottom: 0.5rem; }
    button { background: #2563eb; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 1rem; }
    button:hover { background: #1d4ed8; }
    #result { margin-top: 1rem; padding: 1rem; background: #f3f4f6; border-radius: 4px; }`;

// --- Static Site generators ---

function generateStaticSite(
	config: ProjectConfig,
): string | Record<string, string> {
	switch (config.uiFramework) {
		case "vanilla":
			return generateStaticSiteVanilla(config);
		case "htmx":
			return generateStaticSiteHtmx(config);
		case "alpine":
			return generateStaticSiteAlpine(config);
		case "crank":
			return generateStaticSiteCrank(config);
	}
}

function generateStaticSiteVanilla(
	config: ProjectConfig,
): Record<string, string> {
	const ext = config.typescript ? "ts" : "js";
	const t = config.typescript;
	return {
		[`server.${ext}`]: `import {Router} from "@b9g/router";
import {assets} from "@b9g/assets/middleware";
${
	t
		? `// @ts-expect-error — asset URL resolved by Shovel build system
`
		: ""
}import clientUrl from "./client.${ext}" with {assetBase: "/assets/"};

const router = new Router();
router.use(assets());

router.route("/").get(() => {
  return new Response(renderPage("Home", \`
    <h1>Welcome to ${config.name}</h1>
    <p>Edit <code>src/server.${ext}</code> to get started.</p>
    <button id="counter">Clicked: 0</button>
    <p><a href="/about">About</a></p>
  \`), {
    headers: { "Content-Type": "text/html" },
  });
});

router.route("/about").get(() => {
  return new Response(renderPage("About", \`
    <h1>About</h1>
    <p>This is a static site built with <strong>Shovel</strong>.</p>
    <p><a href="/">Home</a></p>
  \`), {
    headers: { "Content-Type": "text/html" },
  });
});

function renderPage(title${t ? ": string" : ""}, content${t ? ": string" : ""})${t ? ": string" : ""} {
  return \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${title} - ${config.name}</title>
  <style>
${css}
  </style>
</head>
<body>
  <main>\${content}</main>
  <script src="\${clientUrl}" type="module"></script>
</body>
</html>\`;
}

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
`,
		[`client.${ext}`]: `const btn = document.getElementById("counter");
if (btn) {
  let count = 0;
  btn.addEventListener("click", () => btn.textContent = "Clicked: " + ++count);
}
`,
	};
}

function generateStaticSiteHtmx(config: ProjectConfig): Record<string, string> {
	const ext = config.typescript ? "ts" : "js";
	const t = config.typescript;
	const files: Record<string, string> = {
		[`server.${ext}`]: `import {Router} from "@b9g/router";
import {assets} from "@b9g/assets/middleware";
${
	t
		? `// @ts-expect-error — asset URL resolved by Shovel build system
`
		: ""
}import clientUrl from "./client.${ext}" with {assetBase: "/assets/"};

const router = new Router();
router.use(assets());

router.route("/").get(() => {
  return new Response(renderPage("Home", \`
    <h1>Welcome to ${config.name}</h1>
    <p>Edit <code>src/server.${ext}</code> to get started.</p>
    <button hx-get="/greeting" hx-target="#result" hx-swap="innerHTML">Get Greeting</button>
    <div id="result"></div>
    <p><a href="/about">About</a></p>
  \`), {
    headers: { "Content-Type": "text/html" },
  });
});

router.route("/greeting").get(() => {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return new Response(\`<p>\${greeting}! The time is \${new Date().toLocaleTimeString()}.</p>\`, {
    headers: { "Content-Type": "text/html" },
  });
});

router.route("/about").get(() => {
  return new Response(renderPage("About", \`
    <h1>About</h1>
    <p>This is a static site built with <strong>Shovel</strong> and <strong>HTMX</strong>.</p>
    <p><a href="/">Home</a></p>
  \`), {
    headers: { "Content-Type": "text/html" },
  });
});

function renderPage(title${t ? ": string" : ""}, content${t ? ": string" : ""})${t ? ": string" : ""} {
  return \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${title} - ${config.name}</title>
  <style>
${css}
  </style>
</head>
<body>
  <main>\${content}</main>
  <script src="\${clientUrl}" type="module"></script>
</body>
</html>\`;
}

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
`,
		[`client.${ext}`]: `import "htmx.org";
`,
	};
	if (t) {
		files[`env.d.ts`] = `declare module "htmx.org";
`;
	}
	return files;
}

function generateStaticSiteAlpine(
	config: ProjectConfig,
): Record<string, string> {
	const ext = config.typescript ? "ts" : "js";
	const t = config.typescript;
	const files: Record<string, string> = {
		[`server.${ext}`]: `import {Router} from "@b9g/router";
import {assets} from "@b9g/assets/middleware";
${
	t
		? `// @ts-expect-error — asset URL resolved by Shovel build system
`
		: ""
}import clientUrl from "./client.${ext}" with {assetBase: "/assets/"};

const router = new Router();
router.use(assets());

router.route("/").get(() => {
  return new Response(renderPage("Home", \`
    <h1>Welcome to ${config.name}</h1>
    <p>Edit <code>src/server.${ext}</code> to get started.</p>
    <div x-data="{ count: 0 }">
      <button @click="count++">Clicked: <span x-text="count"></span></button>
    </div>
    <p><a href="/about">About</a></p>
  \`), {
    headers: { "Content-Type": "text/html" },
  });
});

router.route("/about").get(() => {
  return new Response(renderPage("About", \`
    <h1>About</h1>
    <p>This is a static site built with <strong>Shovel</strong> and <strong>Alpine.js</strong>.</p>
    <p><a href="/">Home</a></p>
  \`), {
    headers: { "Content-Type": "text/html" },
  });
});

function renderPage(title${t ? ": string" : ""}, content${t ? ": string" : ""})${t ? ": string" : ""} {
  return \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${title} - ${config.name}</title>
  <style>
${css}
  </style>
</head>
<body>
  <main>\${content}</main>
  <script src="\${clientUrl}" type="module"></script>
</body>
</html>\`;
}

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
`,
		[`client.${ext}`]: `import Alpine from "alpinejs";
Alpine.start();
`,
	};
	if (t) {
		files[`env.d.ts`] = `declare module "alpinejs" {
  interface Alpine {
    start(): void;
    plugin(plugin: unknown): void;
    [key: string]: unknown;
  }
  const alpine: Alpine;
  export default alpine;
}
`;
	}
	return files;
}

function generateStaticSiteCrank(
	config: ProjectConfig,
): Record<string, string> {
	const t = config.typescript;
	const ext = config.useJSX
		? config.typescript
			? "tsx"
			: "jsx"
		: config.typescript
			? "ts"
			: "js";

	if (config.useJSX) {
		return {
			[`server.${ext}`]: `import {renderer} from "@b9g/crank/html";
import {Router} from "@b9g/router";
import {assets} from "@b9g/assets/middleware";
import {Page, Counter} from "./components";
${
	t
		? `// @ts-expect-error — asset URL resolved by Shovel build system
`
		: ""
}import clientUrl from "./client.${ext}" with {assetBase: "/assets/"};

const router = new Router();
router.use(assets());

router.route("/").get(async () => {
  const html = await renderer.render(
    <Page title="Home" clientUrl={clientUrl}>
      <h1>Welcome to ${config.name}</h1>
      <p>Edit <code>src/server.${ext}</code> to get started.</p>
      <div id="counter"><Counter /></div>
      <p><a href="/about">About</a></p>
    </Page>
  );
  return new Response("<!DOCTYPE html>" + html, {
    headers: { "Content-Type": "text/html" },
  });
});

router.route("/about").get(async () => {
  const html = await renderer.render(
    <Page title="About">
      <h1>About</h1>
      <p>This is a static site built with <strong>Shovel</strong> and <strong>Crank.js</strong>.</p>
      <p><a href="/">Home</a></p>
    </Page>
  );
  return new Response("<!DOCTYPE html>" + html, {
    headers: { "Content-Type": "text/html" },
  });
});

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
`,
			[`components.${ext}`]: `${t ? 'import type {Context} from "@b9g/crank";\n\n' : ""}const css = \`
${css}
\`;

export function Page({title, children, clientUrl}${t ? ": {title: string, children: unknown, clientUrl?: string}" : ""}) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title} - ${config.name}</title>
        <style>{css}</style>
      </head>
      <body>
        <main>{children}</main>
        {clientUrl && <script src={clientUrl} type="module" />}
      </body>
    </html>
  );
}

export function *Counter(${t ? "this: Context" : ""}) {
  let count = 0;
  const handleClick = () => {
    count++;
    this.refresh();
  };
  for ({} of this) {
    yield <button onclick={handleClick}>Clicked: {count}</button>;
  }
}
`,
			[`client.${ext}`]: `import {renderer} from "@b9g/crank/dom";
import {Counter} from "./components";

renderer.hydrate(<Counter />, document.getElementById("counter")${t ? "!" : ""});
`,
		};
	}

	// Tagged template literals path
	return {
		[`server.${ext}`]: `import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
import {Router} from "@b9g/router";
import {assets} from "@b9g/assets/middleware";
import {Page, Counter} from "./components";
${
	t
		? `// @ts-expect-error — asset URL resolved by Shovel build system
`
		: ""
}import clientUrl from "./client.${ext}" with {assetBase: "/assets/"};

const router = new Router();
router.use(assets());

router.route("/").get(async () => {
  const html = await renderer.render(jsx\`
    <\${Page} title="Home" clientUrl=\${clientUrl}>
      <h1>Welcome to ${config.name}</h1>
      <p>Edit <code>src/server.${ext}</code> to get started.</p>
      <div id="counter"><\${Counter} /></div>
      <p><a href="/about">About</a></p>
    </\${Page}>
  \`);
  return new Response("<!DOCTYPE html>" + html, {
    headers: { "Content-Type": "text/html" },
  });
});

router.route("/about").get(async () => {
  const html = await renderer.render(jsx\`
    <\${Page} title="About">
      <h1>About</h1>
      <p>This is a static site built with <strong>Shovel</strong> and <strong>Crank.js</strong>.</p>
      <p><a href="/">Home</a></p>
    </\${Page}>
  \`);
  return new Response("<!DOCTYPE html>" + html, {
    headers: { "Content-Type": "text/html" },
  });
});

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
`,
		[`components.${ext}`]: `import {jsx} from "@b9g/crank/standalone";
${t ? 'import type {Context} from "@b9g/crank/standalone";\n\n' : "\n"}const css = \`
${css}
\`;

export function Page({title, children, clientUrl}${t ? ": {title: string, children: unknown, clientUrl?: string}" : ""}) {
  return jsx\`
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>\${title} - ${config.name}</title>
        <style>\${css}</style>
      </head>
      <body>
        <main>\${children}</main>
        \${clientUrl && jsx\`<script src=\${clientUrl} type="module" />\`}
      </body>
    </html>
  \`;
}

export function *Counter(${t ? "this: Context" : ""}) {
  let count = 0;
  const handleClick = () => {
    count++;
    this.refresh();
  };
  for ({} of this) {
    yield jsx\`<button onclick=\${handleClick}>Clicked: \${count}</button>\`;
  }
}
`,
		[`client.${ext}`]: `import {jsx, renderer} from "@b9g/crank/standalone";
import {Counter} from "./components";

renderer.hydrate(jsx\`<\${Counter} />\`, document.getElementById("counter")${t ? "!" : ""});
`,
	};
}

// --- Full Stack generators ---

function generateFullStack(
	config: ProjectConfig,
): string | Record<string, string> {
	switch (config.uiFramework) {
		case "vanilla":
			return generateFullStackVanilla(config);
		case "htmx":
			return generateFullStackHtmx(config);
		case "alpine":
			return generateFullStackAlpine(config);
		case "crank":
			return generateFullStackCrank(config);
	}
}

function generateFullStackVanilla(
	config: ProjectConfig,
): Record<string, string> {
	const ext = config.typescript ? "ts" : "js";
	const t = config.typescript;
	return {
		[`server.${ext}`]: `import {Router} from "@b9g/router";
import {logger} from "@b9g/router/middleware";
import {assets} from "@b9g/assets/middleware";
${
	t
		? `// @ts-expect-error — asset URL resolved by Shovel build system
`
		: ""
}import clientUrl from "./client.${ext}" with {assetBase: "/assets/"};

const router = new Router();
router.use(logger());
router.use(assets());

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

// HTML pages
router.route("/").get(() => {
  return new Response(renderPage("Home", \`
    <h1>Welcome to ${config.name}</h1>
    <p>Edit <code>src/server.${ext}</code> to get started.</p>
    <button id="call-api">Call API</button>
    <div id="result"></div>
    <ul>
      <li><a href="/about">About</a></li>
      <li><a href="/api/hello">API: /api/hello</a></li>
    </ul>
  \`), {
    headers: { "Content-Type": "text/html" },
  });
});

router.route("/about").get(() => {
  return new Response(renderPage("About", \`
    <h1>About</h1>
    <p>This is a full-stack app built with <strong>Shovel</strong>.</p>
    <p><a href="/">Home</a></p>
  \`), {
    headers: { "Content-Type": "text/html" },
  });
});

function renderPage(title${t ? ": string" : ""}, content${t ? ": string" : ""})${t ? ": string" : ""} {
  return \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${title} - ${config.name}</title>
  <style>
${css}
  </style>
</head>
<body>
  <main>\${content}</main>
  <script src="\${clientUrl}" type="module"></script>
</body>
</html>\`;
}

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
`,
		[`client.${ext}`]: `const callBtn = document.getElementById("call-api");
if (callBtn) {
  callBtn.addEventListener("click", async () => {
    const res = await fetch("/api/hello");
    const data = await res.json();
    const result = document.getElementById("result");
    if (result) {
      result.innerHTML =
        \`<p>\${data.message}</p><p><small>\${data.timestamp}</small></p>\`;
    }
  });
}
`,
	};
}

function generateFullStackHtmx(config: ProjectConfig): Record<string, string> {
	const ext = config.typescript ? "ts" : "js";
	const t = config.typescript;
	const files: Record<string, string> = {
		[`server.${ext}`]: `import {Router} from "@b9g/router";
import {logger} from "@b9g/router/middleware";
import {assets} from "@b9g/assets/middleware";
${
	t
		? `// @ts-expect-error — asset URL resolved by Shovel build system
`
		: ""
}import clientUrl from "./client.${ext}" with {assetBase: "/assets/"};

const router = new Router();
router.use(logger());
router.use(assets());

// API routes — return HTML fragments when HTMX requests, JSON otherwise
router.route("/api/hello").get((req) => {
  const data = {
    message: "Hello from the API!",
    timestamp: new Date().toISOString(),
  };

  if (req.headers.get("HX-Request")) {
    return new Response(\`<p>\${data.message}</p><p><small>\${data.timestamp}</small></p>\`, {
      headers: { "Content-Type": "text/html" },
    });
  }
  return Response.json(data);
});

router.route("/api/echo").post(async (req) => {
  const body = await req.json();
  return Response.json({ echo: body });
});

// HTML pages
router.route("/").get(() => {
  return new Response(renderPage("Home", \`
    <h1>Welcome to ${config.name}</h1>
    <p>Edit <code>src/server.${ext}</code> to get started.</p>
    <button hx-get="/api/hello" hx-target="#result" hx-swap="innerHTML">Call API</button>
    <div id="result"></div>
    <ul>
      <li><a href="/about">About</a></li>
      <li><a href="/api/hello">API: /api/hello</a></li>
    </ul>
  \`), {
    headers: { "Content-Type": "text/html" },
  });
});

router.route("/about").get(() => {
  return new Response(renderPage("About", \`
    <h1>About</h1>
    <p>This is a full-stack app built with <strong>Shovel</strong> and <strong>HTMX</strong>.</p>
    <p><a href="/">Home</a></p>
  \`), {
    headers: { "Content-Type": "text/html" },
  });
});

function renderPage(title${t ? ": string" : ""}, content${t ? ": string" : ""})${t ? ": string" : ""} {
  return \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${title} - ${config.name}</title>
  <style>
${css}
  </style>
</head>
<body>
  <main>\${content}</main>
  <script src="\${clientUrl}" type="module"></script>
</body>
</html>\`;
}

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
`,
		[`client.${ext}`]: `import "htmx.org";
`,
	};
	if (t) {
		files[`env.d.ts`] = `declare module "htmx.org";
`;
	}
	return files;
}

function generateFullStackAlpine(
	config: ProjectConfig,
): Record<string, string> {
	const ext = config.typescript ? "ts" : "js";
	const t = config.typescript;
	const files: Record<string, string> = {
		[`server.${ext}`]: `import {Router} from "@b9g/router";
import {logger} from "@b9g/router/middleware";
import {assets} from "@b9g/assets/middleware";
${
	t
		? `// @ts-expect-error — asset URL resolved by Shovel build system
`
		: ""
}import clientUrl from "./client.${ext}" with {assetBase: "/assets/"};

const router = new Router();
router.use(logger());
router.use(assets());

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

// HTML pages
router.route("/").get(() => {
  return new Response(renderPage("Home", \`
    <h1>Welcome to ${config.name}</h1>
    <p>Edit <code>src/server.${ext}</code> to get started.</p>
    <div x-data="{ result: null }">
      <button @click="fetch('/api/hello').then(r => r.json()).then(d => result = d)">Call API</button>
      <div id="result" x-show="result">
        <p x-text="result?.message"></p>
        <p><small x-text="result?.timestamp"></small></p>
      </div>
    </div>
    <ul>
      <li><a href="/about">About</a></li>
      <li><a href="/api/hello">API: /api/hello</a></li>
    </ul>
  \`), {
    headers: { "Content-Type": "text/html" },
  });
});

router.route("/about").get(() => {
  return new Response(renderPage("About", \`
    <h1>About</h1>
    <p>This is a full-stack app built with <strong>Shovel</strong> and <strong>Alpine.js</strong>.</p>
    <p><a href="/">Home</a></p>
  \`), {
    headers: { "Content-Type": "text/html" },
  });
});

function renderPage(title${t ? ": string" : ""}, content${t ? ": string" : ""})${t ? ": string" : ""} {
  return \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${title} - ${config.name}</title>
  <style>
${css}
  </style>
</head>
<body>
  <main>\${content}</main>
  <script src="\${clientUrl}" type="module"></script>
</body>
</html>\`;
}

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
`,
		[`client.${ext}`]: `import Alpine from "alpinejs";
Alpine.start();
`,
	};
	if (t) {
		files[`env.d.ts`] = `declare module "alpinejs" {
  interface Alpine {
    start(): void;
    plugin(plugin: unknown): void;
    [key: string]: unknown;
  }
  const alpine: Alpine;
  export default alpine;
}
`;
	}
	return files;
}

function generateFullStackCrank(config: ProjectConfig): Record<string, string> {
	const t = config.typescript;
	const ext = config.useJSX
		? config.typescript
			? "tsx"
			: "jsx"
		: config.typescript
			? "ts"
			: "js";

	if (config.useJSX) {
		return {
			[`server.${ext}`]: `import {renderer} from "@b9g/crank/html";
import {Router} from "@b9g/router";
import {logger} from "@b9g/router/middleware";
import {assets} from "@b9g/assets/middleware";
import {Page, Counter} from "./components";
${
	t
		? `// @ts-expect-error — asset URL resolved by Shovel build system
`
		: ""
}import clientUrl from "./client.${ext}" with {assetBase: "/assets/"};

const router = new Router();
router.use(logger());
router.use(assets());

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

// HTML pages
router.route("/").get(async () => {
  const html = await renderer.render(
    <Page title="Home" clientUrl={clientUrl}>
      <h1>Welcome to ${config.name}</h1>
      <p>Edit <code>src/server.${ext}</code> to get started.</p>
      <div id="counter"><Counter /></div>
      <ul>
        <li><a href="/about">About</a></li>
        <li><a href="/api/hello">API: /api/hello</a></li>
      </ul>
    </Page>
  );
  return new Response("<!DOCTYPE html>" + html, {
    headers: { "Content-Type": "text/html" },
  });
});

router.route("/about").get(async () => {
  const html = await renderer.render(
    <Page title="About">
      <h1>About</h1>
      <p>This is a full-stack app built with <strong>Shovel</strong> and <strong>Crank.js</strong>.</p>
      <p><a href="/">Home</a></p>
    </Page>
  );
  return new Response("<!DOCTYPE html>" + html, {
    headers: { "Content-Type": "text/html" },
  });
});

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
`,
			[`components.${ext}`]: `${t ? 'import type {Context} from "@b9g/crank";\n\n' : ""}const css = \`
${css}
\`;

export function Page({title, children, clientUrl}${t ? ": {title: string, children: unknown, clientUrl?: string}" : ""}) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title} - ${config.name}</title>
        <style>{css}</style>
      </head>
      <body>
        <main>{children}</main>
        {clientUrl && <script src={clientUrl} type="module" />}
      </body>
    </html>
  );
}

export function *Counter(${t ? "this: Context" : ""}) {
  let count = 0;
  const handleClick = () => {
    count++;
    this.refresh();
  };
  for ({} of this) {
    yield <button onclick={handleClick}>Clicked: {count}</button>;
  }
}
`,
			[`client.${ext}`]: `import {renderer} from "@b9g/crank/dom";
import {Counter} from "./components";

renderer.hydrate(<Counter />, document.getElementById("counter")${t ? "!" : ""});
`,
		};
	}

	// Tagged template literals path
	return {
		[`server.${ext}`]: `import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
import {Router} from "@b9g/router";
import {logger} from "@b9g/router/middleware";
import {assets} from "@b9g/assets/middleware";
import {Page, Counter} from "./components";
${
	t
		? `// @ts-expect-error — asset URL resolved by Shovel build system
`
		: ""
}import clientUrl from "./client.${ext}" with {assetBase: "/assets/"};

const router = new Router();
router.use(logger());
router.use(assets());

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

// HTML pages
router.route("/").get(async () => {
  const html = await renderer.render(jsx\`
    <\${Page} title="Home" clientUrl=\${clientUrl}>
      <h1>Welcome to ${config.name}</h1>
      <p>Edit <code>src/server.${ext}</code> to get started.</p>
      <div id="counter"><\${Counter} /></div>
      <ul>
        <li><a href="/about">About</a></li>
        <li><a href="/api/hello">API: /api/hello</a></li>
      </ul>
    </\${Page}>
  \`);
  return new Response("<!DOCTYPE html>" + html, {
    headers: { "Content-Type": "text/html" },
  });
});

router.route("/about").get(async () => {
  const html = await renderer.render(jsx\`
    <\${Page} title="About">
      <h1>About</h1>
      <p>This is a full-stack app built with <strong>Shovel</strong> and <strong>Crank.js</strong>.</p>
      <p><a href="/">Home</a></p>
    </\${Page}>
  \`);
  return new Response("<!DOCTYPE html>" + html, {
    headers: { "Content-Type": "text/html" },
  });
});

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
`,
		[`components.${ext}`]: `import {jsx} from "@b9g/crank/standalone";
${t ? 'import type {Context} from "@b9g/crank/standalone";\n\n' : "\n"}const css = \`
${css}
\`;

export function Page({title, children, clientUrl}${t ? ": {title: string, children: unknown, clientUrl?: string}" : ""}) {
  return jsx\`
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>\${title} - ${config.name}</title>
        <style>\${css}</style>
      </head>
      <body>
        <main>\${children}</main>
        \${clientUrl && jsx\`<script src=\${clientUrl} type="module" />\`}
      </body>
    </html>
  \`;
}

export function *Counter(${t ? "this: Context" : ""}) {
  let count = 0;
  const handleClick = () => {
    count++;
    this.refresh();
  };
  for ({} of this) {
    yield jsx\`<button onclick=\${handleClick}>Clicked: \${count}</button>\`;
  }
}
`,
		[`client.${ext}`]: `import {jsx, renderer} from "@b9g/crank/standalone";
import {Counter} from "./components";

renderer.hydrate(jsx\`<\${Counter} />\`, document.getElementById("counter")${t ? "!" : ""});
`,
	};
}

// --- README generator ---

function generateReadme(config: ProjectConfig): string {
	const templateDescriptions: Record<string, string> = {
		"hello-world": "A minimal Shovel application",
		api: "A REST API with JSON endpoints",
		"static-site": "A static site with server-rendered pages",
		"full-stack": "A full-stack app with HTML pages and API routes",
	};

	const frameworkDescriptions: Record<string, string> = {
		vanilla: "",
		htmx: " using [HTMX](https://htmx.org)",
		alpine: " using [Alpine.js](https://alpinejs.dev)",
		crank: " using [Crank.js](https://crank.js.org) with hydration",
	};

	const ext =
		config.uiFramework === "crank" && config.useJSX
			? config.typescript
				? "tsx"
				: "jsx"
			: config.typescript
				? "ts"
				: "js";
	const isCrank = config.uiFramework === "crank";
	const hasClientBundle =
		config.template === "static-site" || config.template === "full-stack";

	let projectTree: string;
	if (isCrank) {
		projectTree = `${config.name}/
├── src/
│   ├── server.${ext}       # Application entry point
│   ├── components.${ext}   # Page components
│   └── client.${ext}       # Client-side hydration
├── eslint.config.js
├── package.json
${config.typescript ? "├── tsconfig.json\n" : ""}└── README.md`;
	} else if (hasClientBundle) {
		projectTree = `${config.name}/
├── src/
│   ├── server.${ext}   # Application entry point
│   └── client.${ext}   # Client-side code
├── eslint.config.js
├── package.json
${config.typescript ? "├── tsconfig.json\n" : ""}└── README.md`;
	} else {
		projectTree = `${config.name}/
├── src/
│   └── app.${ext}    # Application entry point
├── package.json
${config.typescript ? "├── tsconfig.json\n" : ""}└── README.md`;
	}

	return `# ${config.name}

${templateDescriptions[config.template]}${frameworkDescriptions[config.uiFramework]}, built with [Shovel](https://github.com/bikeshaving/shovel).

## Getting Started

\`\`\`bash
npm install
npm run develop
\`\`\`

Open http://localhost:7777

## Scripts

- \`npm run develop\` - Start development server
- \`npm run build\` - Build for production
- \`npm start\` - Run production build${hasClientBundle ? "\n- `npm run lint` - Lint source files" : ""}

## Project Structure

\`\`\`
${projectTree}
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
