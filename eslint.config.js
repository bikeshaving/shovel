import b9g from "@b9g/eslint-config";

export default [
	...b9g,
	{
		ignores: [
			"**/.wrangler/**",
			"examples/tfb/**",
			"packages/shovel-wpt/wpt/**",
			"packages/shovel-wpt/test/fixtures/**",
		],
	},
	{
		languageOptions: {
			globals: {
				__dirname: "readonly",
				__filename: "readonly",
				global: "readonly",
			},
		},
		rules: {
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
			"no-restricted-syntax": [
				"error",
				{
					selector: "ImportExpression[source.type!='Literal']",
					message:
						"Dynamic import with variable is not allowed. esbuild cannot analyze variable imports.",
				},
			],
		},
	},
];
