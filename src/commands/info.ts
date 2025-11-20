import {getLogger} from "@logtape/logtape";

const logger = getLogger(["cli"]);

export async function infoCommand() {
	const {detectRuntime, detectDevelopmentPlatform} = await import(
		"@b9g/platform"
	);

	logger.info("Shovel Platform Information", {});
	logger.info("---", {});
	logger.info("Current Runtime", {runtime: detectRuntime()});
	logger.info("Default Platform", {platform: detectDevelopmentPlatform()});
}
