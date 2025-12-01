/**
 * Tests for the ServiceWorker Runtime
 *
 * Runs contract tests against the Shovel runtime implementation
 * based on WPT service-worker tests.
 */

import {runRuntimeTests} from "../src/runners/runtime.js";
import {
	ExtendableEvent,
	FetchEvent,
	InstallEvent,
	ActivateEvent,
} from "../../platform/src/runtime.js";

// Internal symbol for ending dispatch phase
const kEndDispatchPhase = Symbol.for("shovel.endDispatchPhase");

// Run WPT-based runtime tests against Shovel's implementation
runRuntimeTests("Shovel Runtime", {
	createExtendableEvent: (type: string) => new ExtendableEvent(type),

	createFetchEvent: (request: Request) => new FetchEvent(request),

	createInstallEvent: () => new InstallEvent(),

	createActivateEvent: () => new ActivateEvent(),

	endDispatchPhase: (event: any) => {
		event[kEndDispatchPhase]();
	},

	getPromises: (event: any) => {
		return event.getPromises();
	},
});
