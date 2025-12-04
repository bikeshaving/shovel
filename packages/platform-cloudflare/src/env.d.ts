// Vite-style import.meta.env declaration
interface ImportMetaEnv {
	MODE?: string;
	[key: string]: string | undefined;
}

interface ImportMeta {
	readonly env?: ImportMetaEnv;
}
