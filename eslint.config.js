import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import prettier from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

export default [
	// Global ignores must come first
	{
		ignores: [
			"node_modules/**",
			"**/node_modules/**",
			"**/dist/**",
			"**/build/**",
			"**/coverage/**",
			"**/*.min.js",
			"examples/tfb/**", // Third-party framework benchmarks - not our code
			"packages/shovel-wpt/wpt/**", // Web Platform Tests - third-party test suite
			"packages/shovel-wpt/test/fixtures/**", // Dynamically generated test fixtures
		],
	},
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
			"no-console": "error",
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
					property: "cwd",
					message:
						"Do not use process.cwd(). Use findProjectRoot() from src/utils/project.ts instead.",
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
				{
					name: "require",
					message: "Do not use require(). Use ES module imports instead.",
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
			// Disallow empty catch blocks - errors should be logged or handled
			"no-useless-catch": "error",
			"no-empty": ["error", {allowEmptyCatch: false}],
			// Code style: No explicit accessibility modifiers, use # for private
			// Disallow ALL accessibility modifiers and property initializers
			"no-restricted-syntax": [
				"error",
				{
					selector: "CatchClause[param=null]",
					message:
						"Empty catch binding not allowed. Catch and log the error with LogTape.",
				},
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
				{
					selector: "ImportExpression[source.type!='Literal']",
					message:
						"Dynamic import with variable is not allowed. esbuild cannot analyze variable imports.",
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
];
