export async function infoCommand() {
	const {detectRuntime, detectDevelopmentPlatform} = await import(
		"@b9g/platform"
	);

	console.info("🔍 Shovel Platform Information");
	console.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
	console.info(`Current Runtime: ${detectRuntime()}`);
	console.info(`Default Platform: ${detectDevelopmentPlatform()}`);
}
