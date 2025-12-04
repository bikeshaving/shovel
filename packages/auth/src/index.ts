/**
 * @b9g/auth - Universal authentication for ServiceWorker applications
 *
 * This package provides:
 * - OAuth2/PKCE: import from "@b9g/auth/oauth2" and "@b9g/auth/pkce"
 * - Provider presets: import from "@b9g/auth/providers"
 * - Router middleware: import from "@b9g/auth/middleware"
 */

throw new Error(
	"@b9g/auth has no default export. Import from subpaths:\n" +
		'  import {OAuth2Client} from "@b9g/auth/oauth2"\n' +
		'  import {generateCodeVerifier} from "@b9g/auth/pkce"\n' +
		'  import {providers} from "@b9g/auth/providers"\n' +
		'  import {cors, requireAuth} from "@b9g/auth/middleware"',
);
