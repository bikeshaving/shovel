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
