import {getLogger} from "@logtape/logtape";
import {detectRuntime, detectDevelopmentPlatform} from "@b9g/platform";
import {configureLogging} from "@b9g/platform/runtime";
import {loadConfig} from "../config.js";
import {findProjectRoot} from "../utils/project.js";

// Load config and configure logging before anything else
const projectRoot = findProjectRoot();
const config = loadConfig(projectRoot);
await configureLogging(config.logging);

const logger = getLogger(["cli"]);

export async function infoCommand() {
	logger.info("Shovel Platform Information", {});
	logger.info("---", {});
	logger.info("Current Runtime", {runtime: detectRuntime()});
	logger.info("Default Platform", {platform: detectDevelopmentPlatform()});
}
