/**
 * TypeScript declarations for asset imports with { url: '/assets/' }
 *
 * Add this to your project's global types or import it in your app
 */

// Export a dummy type to make this a module
export {};

// Global declarations

declare module "*.svg" {
	const url: string;
	export default url;
}

declare module "*.png" {
	const url: string;
	export default url;
}

declare module "*.jpg" {
	const url: string;
	export default url;
}

declare module "*.jpeg" {
	const url: string;
	export default url;
}

declare module "*.gif" {
	const url: string;
	export default url;
}

declare module "*.webp" {
	const url: string;
	export default url;
}

declare module "*.avif" {
	const url: string;
	export default url;
}

declare module "*.ico" {
	const url: string;
	export default url;
}

declare module "*.css" {
	const url: string;
	export default url;
}

declare module "*.scss" {
	const url: string;
	export default url;
}

declare module "*.sass" {
	const url: string;
	export default url;
}

declare module "*.less" {
	const url: string;
	export default url;
}

declare module "*.woff" {
	const url: string;
	export default url;
}

declare module "*.woff2" {
	const url: string;
	export default url;
}

declare module "*.ttf" {
	const url: string;
	export default url;
}

declare module "*.otf" {
	const url: string;
	export default url;
}

declare module "*.eot" {
	const url: string;
	export default url;
}

declare module "*.mp4" {
	const url: string;
	export default url;
}

declare module "*.webm" {
	const url: string;
	export default url;
}

declare module "*.mp3" {
	const url: string;
	export default url;
}

declare module "*.wav" {
	const url: string;
	export default url;
}

declare module "*.flac" {
	const url: string;
	export default url;
}

declare module "*.aac" {
	const url: string;
	export default url;
}

declare module "*.pdf" {
	const url: string;
	export default url;
}

declare module "*.txt" {
	const url: string;
	export default url;
}

declare module "*.md" {
	const url: string;
	export default url;
}

declare module "*.json" {
	const url: string;
	export default url;
}

declare module "*.xml" {
	const url: string;
	export default url;
}

declare module "*.zip" {
	const url: string;
	export default url;
}

// Fallback for any other file type
declare module "*" {
	const url: string;
	export default url;
}
