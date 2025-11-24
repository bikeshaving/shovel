import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import prettier from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

export default [
	js.configs.recommended,
	prettierConfig,
	{
		files: ["**/*.{js,jsx,ts,tsx}"],
		languageOptions: {
			parser: typescriptParser,
			parserOptions: {
				sourceType: "module",
			},
			globals: {
				console: "readonly",
				process: "readonly",
				Buffer: "readonly",
				__dirname: "readonly",
				__filename: "readonly",
				global: "readonly",
				globalThis: "readonly",
			},
		},
		plugins: {
			"@typescript-eslint": typescript,
			prettier,
		},
		rules: {
			"no-console": ["error", {allow: ["info", "warn", "error"]}],
			"no-unused-vars": "off",
			"no-unused-private-class-members": "off",
			// Ban Node-isms to keep code portable
			"no-restricted-properties": [
				"error",
				{
					object: "process",
					property: "env",
					message:
						"Do not use process.env directly. Use import.meta.env or loadConfig() instead.",
				},
				{
					object: "process",
					property: "exit",
					message:
						"Do not use process.exit(). Throw an error or return instead.",
				},
			],
			"no-restricted-globals": [
				"error",
				{
					name: "__dirname",
					message:
						"Do not use __dirname. Use import.meta.url with URL/fileURLToPath instead.",
				},
				{
					name: "__filename",
					message: "Do not use __filename. Use import.meta.url instead.",
				},
			],
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					varsIgnorePattern: "^_",
					argsIgnorePattern: "^_",
					caughtErrors: "none",
				},
			],
			"no-dupe-class-members": "off",
			"@typescript-eslint/no-dupe-class-members": "warn",
			"no-undef": "off",
			"no-redeclare": "off",
			// Code style: No explicit accessibility modifiers, use # for private
			// Disallow ALL accessibility modifiers and property initializers
			"no-restricted-syntax": [
				"error",
				{
					selector:
						"PropertyDefinition[accessibility='private'], PropertyDefinition[accessibility='protected'], PropertyDefinition[accessibility='public']",
					message:
						"Do not use private/protected/public keywords. Use # for private fields.",
				},
				{
					selector:
						"MethodDefinition[accessibility='private'], MethodDefinition[accessibility='protected'], MethodDefinition[accessibility='public']",
					message:
						"Do not use private/protected/public keywords. Use # for private methods.",
				},
				{
					selector: "PropertyDefinition[value]",
					message:
						"Do not use class property initializers. Initialize properties in the constructor.",
				},
			],
			"prettier/prettier": [
				"error",
				{
					trailingComma: "all",
					arrowParens: "always",
					useTabs: true,
					bracketSpacing: false,
				},
			],
		},
	},
	// Allow Node-isms in specific files where they're necessary
	{
		files: [
			"packages/platform/src/config.ts", // Config parser needs process.env
			"packages/node-webworker/**/*.{js,ts}", // Node-specific Worker implementation
			"src/commands/**/*.ts", // CLI commands are Node-specific
			"bin/**/*.ts", // CLI tools are Node-specific
			"test/**/*.{js,ts}", // Tests are Node-specific
			"examples/**/*.{js,ts}", // Examples can use Node APIs
		],
		rules: {
			"no-restricted-properties": "off",
			"no-restricted-globals": "off",
		},
	},
	{
		ignores: [
			"node_modules/**",
			"**/node_modules/**",
			"**/dist/**",
			"**/build/**",
			"**/coverage/**",
			"**/*.min.js",
			"examples/**/dist/**",
			"packages/**/dist/**",
			"examples/tfb/**", // Third-party framework benchmarks - not our code
		],
	},
];
