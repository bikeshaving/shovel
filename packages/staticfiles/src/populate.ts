/**
 * Populate static assets to File System Access API storage
 * 
 * Build-time utility to copy static files from local filesystem
 * to any storage backend (local, S3, R2, etc.) using File System Access API.
 */

import { getFileSystemRoot } from "@b9g/platform";
import * as fs from "fs/promises";
import * as path from "path";

export interface PopulateOptions {
	/** Source directory containing static files */
	sourceDir: string;
	/** File system name/bucket for static assets (default: 'static') */
	filesystem?: string;
	/** Include pattern (glob-like, default: all files) */
	include?: string[];
	/** Exclude pattern (glob-like, default: []) */
	exclude?: string[];
	/** Verbose logging (default: false) */
	verbose?: boolean;
	/** Dry run - don't actually copy files (default: false) */
	dryRun?: boolean;
}

/**
 * Check if a file path matches any of the patterns
 */
function matchesPattern(filePath: string, patterns: string[]): boolean {
	if (patterns.length === 0) return false;
	
	return patterns.some(pattern => {
		// Simple glob-like matching
		const regex = new RegExp(
			'^' + pattern
				.replace(/\./g, '\\.')
				.replace(/\*/g, '.*')
				.replace(/\?/g, '.')
			+ '$'
		);
		return regex.test(filePath);
	});
}

/**
 * Recursively get all files in a directory
 */
async function getAllFiles(dir: string, baseDir: string = dir): Promise<string[]> {
	const files: string[] = [];
	const entries = await fs.readdir(dir, { withFileTypes: true });
	
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		const relativePath = path.relative(baseDir, fullPath);
		
		if (entry.isDirectory()) {
			const subFiles = await getAllFiles(fullPath, baseDir);
			files.push(...subFiles);
		} else if (entry.isFile()) {
			files.push(relativePath);
		}
	}
	
	return files;
}

/**
 * Copy a file from local filesystem to File System Access API storage
 */
async function copyFile(
	sourcePath: string, 
	targetPath: string, 
	targetRoot: FileSystemDirectoryHandle,
	verbose: boolean = false
): Promise<void> {
	// Read source file
	const sourceData = await fs.readFile(sourcePath);
	
	// Create target directory structure if needed
	const pathParts = targetPath.split('/');
	const fileName = pathParts.pop()!;
	
	let currentDir = targetRoot;
	for (const part of pathParts) {
		if (part) { // Skip empty parts
			currentDir = await currentDir.getDirectoryHandle(part, { create: true });
		}
	}
	
	// Create and write to target file
	const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
	const writable = await fileHandle.createWritable();
	
	try {
		await writable.write(sourceData);
		await writable.close();
		
		if (verbose) {
			console.log(`✓ Copied: ${targetPath}`);
		}
	} catch (error) {
		await writable.abort();
		throw error;
	}
}

/**
 * Populate static assets from source directory to File System Access API storage
 */
export async function populateStaticAssets(options: PopulateOptions): Promise<void> {
	const {
		sourceDir,
		filesystem = 'static',
		include = ['**/*'],
		exclude = [],
		verbose = false,
		dryRun = false,
	} = options;

	if (verbose) {
		console.log(`🗂️  Populating static assets from ${sourceDir} to filesystem:${filesystem}`);
		if (dryRun) {
			console.log('📋 DRY RUN - no files will be copied');
		}
	}

	// Check if source directory exists
	try {
		const stats = await fs.stat(sourceDir);
		if (!stats.isDirectory()) {
			throw new Error(`Source path is not a directory: ${sourceDir}`);
		}
	} catch (error) {
		throw new Error(`Source directory not found: ${sourceDir}`);
	}

	// Get all files in source directory
	const allFiles = await getAllFiles(sourceDir);
	
	// Filter files based on include/exclude patterns
	const filteredFiles = allFiles.filter(filePath => {
		const included = include.length === 0 || matchesPattern(filePath, include);
		const excluded = exclude.length > 0 && matchesPattern(filePath, exclude);
		return included && !excluded;
	});

	if (verbose) {
		console.log(`📁 Found ${allFiles.length} total files, ${filteredFiles.length} after filtering`);
	}

	if (filteredFiles.length === 0) {
		console.warn('⚠️  No files to copy after filtering');
		return;
	}

	if (dryRun) {
		console.log('📋 Files that would be copied:');
		filteredFiles.forEach(file => console.log(`  - ${file}`));
		return;
	}

	// Get target filesystem root
	const targetRoot = await getFileSystemRoot(filesystem);

	// Copy files
	let copiedCount = 0;
	let errorCount = 0;

	for (const relativePath of filteredFiles) {
		try {
			const sourcePath = path.join(sourceDir, relativePath);
			await copyFile(sourcePath, relativePath, targetRoot, verbose);
			copiedCount++;
		} catch (error) {
			console.error(`❌ Failed to copy ${relativePath}:`, error);
			errorCount++;
		}
	}

	if (verbose || errorCount > 0) {
		console.log(`✅ Copied ${copiedCount} files successfully`);
		if (errorCount > 0) {
			console.log(`❌ Failed to copy ${errorCount} files`);
		}
	}

	if (errorCount > 0) {
		throw new Error(`Failed to copy ${errorCount} files`);
	}
}

/**
 * Default export for convenience
 */
export default populateStaticAssets;