/**
 * Wrangler integration utilities for Cloudflare Workers
 */

import type {CloudflarePlatformOptions} from "./platform.js";

/**
 * Create platform options from Wrangler environment
 */
export function createOptionsFromEnv(env: any): CloudflarePlatformOptions {
	return {
		environment: env.ENVIRONMENT || "production",
		kvNamespaces: extractKVNamespaces(env),
		r2Buckets: extractR2Buckets(env),
		d1Databases: extractD1Databases(env),
		durableObjects: extractDurableObjects(env),
	};
}

/**
 * Extract KV namespace bindings from environment
 */
function extractKVNamespaces(env: any): Record<string, any> {
	const kvNamespaces: Record<string, any> = {};

	// Look for common KV binding patterns
	for (const [key, value] of Object.entries(env)) {
		if (key.endsWith("_KV") || key.includes("KV")) {
			kvNamespaces[key] = value;
		}
	}

	return kvNamespaces;
}

/**
 * Extract R2 bucket bindings from environment
 */
function extractR2Buckets(env: any): Record<string, any> {
	const r2Buckets: Record<string, any> = {};

	for (const [key, value] of Object.entries(env)) {
		if (key.endsWith("_R2") || key.includes("R2")) {
			r2Buckets[key] = value;
		}
	}

	return r2Buckets;
}

/**
 * Extract D1 database bindings from environment
 */
function extractD1Databases(env: any): Record<string, any> {
	const d1Databases: Record<string, any> = {};

	for (const [key, value] of Object.entries(env)) {
		if (key.endsWith("_D1") || key.includes("D1") || key.endsWith("_DB")) {
			d1Databases[key] = value;
		}
	}

	return d1Databases;
}

/**
 * Extract Durable Object bindings from environment
 */
function extractDurableObjects(env: any): Record<string, any> {
	const durableObjects: Record<string, any> = {};

	for (const [key, value] of Object.entries(env)) {
		if (key.endsWith("_DO") || key.includes("DURABLE")) {
			durableObjects[key] = value;
		}
	}

	return durableObjects;
}

/**
 * Generate wrangler.toml configuration for a Shovel app
 */
export function generateWranglerConfig(options: {
	name: string;
	entrypoint: string;
	kvNamespaces?: string[];
	r2Buckets?: string[];
	d1Databases?: string[];
}): string {
	const {
		name,
		entrypoint,
		kvNamespaces = [],
		r2Buckets = [],
		d1Databases = [],
	} = options;

	return `# Generated wrangler.toml for Shovel app
name = "${name}"
main = "${entrypoint}"
compatibility_date = "2024-01-01"

# ServiceWorker format (since Shovel apps are ServiceWorker-style)
usage_model = "bundled"

# KV bindings
${kvNamespaces
	.map(
		(kv) => `[[kv_namespaces]]
binding = "${kv}"
id = "your-kv-namespace-id"
preview_id = "your-preview-kv-namespace-id"`,
	)
	.join("\n\n")}

# R2 bindings  
${r2Buckets
	.map(
		(bucket) => `[[r2_buckets]]
binding = "${bucket}"
bucket_name = "your-bucket-name"`,
	)
	.join("\n\n")}

# D1 bindings
${d1Databases
	.map(
		(db) => `[[d1_databases]]
binding = "${db}"
database_name = "your-database-name"
database_id = "your-database-id"`,
	)
	.join("\n\n")}
`;
}
