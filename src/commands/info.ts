import {getLogger} from "@logtape/logtape";
import {detectRuntime, detectDevelopmentPlatform} from "@b9g/platform";

const logger = getLogger(["cli"]);

export async function infoCommand() {
	logger.info("Shovel Platform Information", {});
	logger.info("---", {});
	logger.info("Current Runtime", {runtime: detectRuntime()});
	logger.info("Default Platform", {platform: detectDevelopmentPlatform()});
}
