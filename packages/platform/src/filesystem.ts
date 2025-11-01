/**
 * File System Access API implementation
 */

import { getPlatformAsync } from "./registry.js";

/**
 * Get the file system root handle for the specified name
 * Auto-registers Node.js platform if no platform is detected
 */
export async function getFileSystemRoot(name?: string): Promise<FileSystemDirectoryHandle> {
	const platform = await getPlatformAsync();
	return await platform.getFileSystemRoot(name);
}