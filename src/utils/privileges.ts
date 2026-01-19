/**
 * Privileged port access for local HTTPS development
 *
 * Ports below 1024 (like 443 for HTTPS) require special privileges.
 * This module handles the one-time setup needed to bind to these ports
 * without requiring sudo for every `shovel develop` run.
 *
 * Strategies by platform:
 * - macOS: Port forwarding via pf (packet filter)
 * - Linux: setcap on Node/Bun binary, or iptables redirect
 */

import {execSync, spawnSync} from "child_process";
import {existsSync, readFileSync, writeFileSync} from "fs";
import {createServer} from "net";
import {join} from "path";
import {getLogger} from "@logtape/logtape";
import {SHOVEL_DIR} from "./certs.js";

const logger = getLogger(["shovel", "privileges"]);

/**
 * File that tracks if privileged port setup has been completed
 */
const SETUP_COMPLETE_FILE = join(SHOVEL_DIR, "port-setup-complete");

/**
 * High port to use for actual binding when forwarding from 443
 * This should be above 1024 so no special privileges are needed
 */
export const HIGH_PORT = 7443;

/**
 * Result of privilege setup check
 */
export interface PrivilegeCheckResult {
	/** Whether privileged port is accessible */
	accessible: boolean;
	/** If not accessible, the high port to use with forwarding */
	highPort?: number;
	/** Whether port forwarding is set up */
	forwardingActive?: boolean;
}

/**
 * Check if we can bind to a specific port
 */
export function canBindToPort(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();

		server.once("error", (err: NodeJS.ErrnoException) => {
			if (err.code === "EACCES" || err.code === "EADDRINUSE") {
				resolve(false);
			} else {
				// Other errors (like network issues) - assume we can try
				resolve(true);
			}
		});

		server.once("listening", () => {
			server.close(() => resolve(true));
		});

		server.listen(port, "127.0.0.1");
	});
}

/**
 * Check if port forwarding from 443 to HIGH_PORT is already active (macOS)
 */
function isPortForwardingActive(): boolean {
	if (process.platform !== "darwin") {
		return false;
	}

	try {
		// Check if our pf rule is loaded
		const result = spawnSync("sudo", ["pfctl", "-s", "nat"], {
			stdio: "pipe",
			encoding: "utf-8",
		});

		if (result.status !== 0) {
			return false;
		}

		// Look for our forwarding rule
		return result.stdout.includes(`rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 443`);
	} catch {
		return false;
	}
}

/**
 * Set up port forwarding from 443 to HIGH_PORT on macOS using pf
 *
 * This requires sudo once to set up the rule, but after that
 * the application can bind to HIGH_PORT without privileges.
 */
async function setupMacOSPortForwarding(): Promise<void> {
	logger.info("Setting up port forwarding (443 → {highPort})...", {
		highPort: HIGH_PORT,
	});

	// Create pf anchor file for shovel
	const anchorPath = "/etc/pf.anchors/com.shovel";
	const anchorContent = `rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 443 -> 127.0.0.1 port ${HIGH_PORT}\n`;

	try {
		// Write anchor file (requires sudo)
		execSync(`echo '${anchorContent.trim()}' | sudo tee ${anchorPath}`, {
			stdio: "pipe",
		});

		// Check if anchor is already in pf.conf
		const pfConf = readFileSync("/etc/pf.conf", "utf-8");
		if (!pfConf.includes("com.shovel")) {
			// Add anchor references to pf.conf
			// We need to add both the anchor load and the rdr-anchor
			const additions = [
				'rdr-anchor "com.shovel"',
				'load anchor "com.shovel" from "/etc/pf.anchors/com.shovel"',
			];

			for (const line of additions) {
				if (!pfConf.includes(line)) {
					execSync(`echo '${line}' | sudo tee -a /etc/pf.conf`, {
						stdio: "pipe",
					});
				}
			}
		}

		// Reload pf rules
		execSync("sudo pfctl -f /etc/pf.conf", {stdio: "pipe"});

		// Enable pf if not already enabled
		execSync("sudo pfctl -e 2>/dev/null || true", {stdio: "pipe"});

		logger.info("Port forwarding configured successfully");
	} catch (error) {
		throw new Error(
			`Failed to set up port forwarding: ${error instanceof Error ? error.message : error}\n` +
				"You may need to run the following commands manually:\n" +
				`  echo 'rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 443 -> 127.0.0.1 port ${HIGH_PORT}' | sudo tee /etc/pf.anchors/com.shovel\n` +
				"  sudo pfctl -f /etc/pf.conf\n" +
				"  sudo pfctl -e",
		);
	}
}

/**
 * Set up privileged port access on Linux
 *
 * Options:
 * 1. setcap on the Node/Bun binary (allows binding to any port)
 * 2. iptables redirect (similar to macOS pf approach)
 *
 * We prefer iptables redirect as it's less invasive.
 */
async function setupLinuxPortForwarding(): Promise<void> {
	logger.info("Setting up port forwarding (443 → {highPort})...", {
		highPort: HIGH_PORT,
	});

	try {
		// Use iptables to redirect 443 to HIGH_PORT
		execSync(
			`sudo iptables -t nat -A PREROUTING -p tcp --dport 443 -j REDIRECT --to-port ${HIGH_PORT}`,
			{stdio: "pipe"},
		);

		// Also handle localhost traffic (OUTPUT chain)
		execSync(
			`sudo iptables -t nat -A OUTPUT -o lo -p tcp --dport 443 -j REDIRECT --to-port ${HIGH_PORT}`,
			{stdio: "pipe"},
		);

		logger.info("Port forwarding configured successfully");

		// Save iptables rules for persistence
		try {
			execSync("sudo iptables-save | sudo tee /etc/iptables/rules.v4", {
				stdio: "pipe",
			});
		} catch {
			logger.warn(
				"Could not persist iptables rules. They will be lost on reboot.",
			);
		}
	} catch (error) {
		throw new Error(
			`Failed to set up port forwarding: ${error instanceof Error ? error.message : error}\n` +
				"You may need to run the following commands manually:\n" +
				`  sudo iptables -t nat -A PREROUTING -p tcp --dport 443 -j REDIRECT --to-port ${HIGH_PORT}\n` +
				`  sudo iptables -t nat -A OUTPUT -o lo -p tcp --dport 443 -j REDIRECT --to-port ${HIGH_PORT}`,
		);
	}
}

/**
 * Mark that privileged port setup has been completed
 */
function markSetupComplete(): void {
	try {
		const data = {
			timestamp: new Date().toISOString(),
			platform: process.platform,
			highPort: HIGH_PORT,
		};
		writeFileSync(SETUP_COMPLETE_FILE, JSON.stringify(data, null, 2));
	} catch {
		// Non-fatal - we'll just check again next time
	}
}

/**
 * Check if setup was previously completed
 */
function wasSetupCompleted(): boolean {
	try {
		if (existsSync(SETUP_COMPLETE_FILE)) {
			const data = JSON.parse(readFileSync(SETUP_COMPLETE_FILE, "utf-8"));
			return data.platform === process.platform;
		}
	} catch {
		// Ignore errors - will re-check
	}
	return false;
}

/**
 * Ensure we can bind to a privileged port (like 443)
 *
 * This function:
 * 1. Checks if we can directly bind to the port
 * 2. If not, checks if port forwarding is already set up
 * 3. If not, sets up port forwarding (requires sudo once)
 *
 * @param port - The privileged port to ensure access to (e.g., 443)
 * @returns Information about how to access the port
 */
export async function ensurePrivilegedPort(
	port: number,
): Promise<PrivilegeCheckResult> {
	// If port is not privileged (>= 1024), we can always bind
	if (port >= 1024) {
		return {accessible: true};
	}

	// Try to bind directly first
	if (await canBindToPort(port)) {
		return {accessible: true};
	}

	logger.debug("Cannot bind to port {port} directly, checking alternatives", {
		port,
	});

	// Platform-specific handling
	if (process.platform === "darwin") {
		// macOS: Use pf port forwarding
		if (isPortForwardingActive() || wasSetupCompleted()) {
			return {
				accessible: false,
				highPort: HIGH_PORT,
				forwardingActive: true,
			};
		}

		// Need to set up forwarding
		await setupMacOSPortForwarding();
		markSetupComplete();

		return {
			accessible: false,
			highPort: HIGH_PORT,
			forwardingActive: true,
		};
	}

	if (process.platform === "linux") {
		// Linux: Use iptables redirect
		if (wasSetupCompleted()) {
			return {
				accessible: false,
				highPort: HIGH_PORT,
				forwardingActive: true,
			};
		}

		await setupLinuxPortForwarding();
		markSetupComplete();

		return {
			accessible: false,
			highPort: HIGH_PORT,
			forwardingActive: true,
		};
	}

	// Windows or other platforms - not supported yet
	throw new Error(
		`Privileged port access is not yet supported on ${process.platform}.\n` +
			`Please use a port above 1024 (e.g., --port ${HIGH_PORT}).`,
	);
}

/**
 * Get the actual port to bind to, considering port forwarding
 *
 * @param requestedPort - The port the user requested (e.g., 443)
 * @returns The port to actually bind to (may be HIGH_PORT if forwarding is used)
 */
export async function getBindPort(requestedPort: number): Promise<number> {
	const result = await ensurePrivilegedPort(requestedPort);

	if (result.accessible) {
		return requestedPort;
	}

	if (result.forwardingActive && result.highPort) {
		logger.info(
			"Port {requested} forwarded to {actual}",
			{
				requested: requestedPort,
				actual: result.highPort,
			},
		);
		return result.highPort;
	}

	// Shouldn't reach here, but fallback to high port
	return HIGH_PORT;
}
