/**
 * File System Access API implementation
 */

import {getPlatformAsync} from "./registry.js";

/**
 * Get the file system directory handle for the specified name
 * Auto-registers Node.js platform if no platform is detected
 */
export async function getDirectoryHandle(
	name: string,
): Promise<FileSystemDirectoryHandle> {
	const platform = await getPlatformAsync();
	return await platform.getDirectoryHandle(name);
}

/**
 * @deprecated Use getDirectoryHandle() instead
 */
export async function getBucket(
	name?: string,
): Promise<FileSystemDirectoryHandle> {
	const platform = await getPlatformAsync();
	return await platform.getDirectoryHandle(name || "");
}

/**
 * @deprecated Use getDirectoryHandle() instead
 */
export async function getFileSystemRoot(
	name?: string,
): Promise<FileSystemDirectoryHandle> {
	const platform = await getPlatformAsync();
	return await platform.getDirectoryHandle(name || "");
}
