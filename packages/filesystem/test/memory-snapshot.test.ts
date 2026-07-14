import {test, expect, describe} from "bun:test";
import {MemoryDirectory, type DirectorySnapshot} from "../src/memory.js";

/** Helper: base64-encode a UTF-8 string the way the build plugin will. */
function b64(s: string): string {
	const bytes = new TextEncoder().encode(s);
	let bin = "";
	for (const byte of bytes) bin += String.fromCharCode(byte);
	return btoa(bin);
}

describe("MemoryDirectory.fromSnapshot", () => {
	const snapshot: DirectorySnapshot = {
		files: {
			"index.md": {data: b64("# Home\n"), type: "text/markdown"},
		},
		directories: {
			guides: {
				files: {
					"intro.md": {data: b64("intro"), lastModified: 42},
				},
			},
			img: {
				files: {
					// 1x1 transparent PNG-ish bytes to prove binary round-trips
					"pixel.bin": {data: btoa("\x00\x01\x02\xff")},
				},
			},
		},
	};

	test("materializes top-level files with content and type", async () => {
		const dir = MemoryDirectory.fromSnapshot("content", snapshot);
		expect(dir.name).toBe("content");

		const fh = await dir.getFileHandle("index.md");
		const file = await fh.getFile();
		expect(await file.text()).toBe("# Home\n");
	});

	test("enumerates entries (the capability CF assets dir lacks)", async () => {
		const dir = MemoryDirectory.fromSnapshot("content", snapshot);
		const names: string[] = [];
		for await (const name of dir.keys()) names.push(name);
		expect(names.sort()).toEqual(["guides", "img", "index.md"]);
	});

	test("materializes nested directories and their files", async () => {
		const dir = MemoryDirectory.fromSnapshot("content", snapshot);
		const guides = await dir.getDirectoryHandle("guides");
		const fh = await guides.getFileHandle("intro.md");
		expect(await (await fh.getFile()).text()).toBe("intro");
	});

	test("round-trips binary content byte-for-byte", async () => {
		const dir = MemoryDirectory.fromSnapshot("content", snapshot);
		const img = await dir.getDirectoryHandle("img");
		const fh = await img.getFileHandle("pixel.bin");
		const bytes = new Uint8Array(await (await fh.getFile()).arrayBuffer());
		expect(Array.from(bytes)).toEqual([0x00, 0x01, 0x02, 0xff]);
	});

	test("empty snapshot yields an empty but usable directory", async () => {
		const dir = MemoryDirectory.fromSnapshot("empty", {});
		const names: string[] = [];
		for await (const name of dir.keys()) names.push(name);
		expect(names).toEqual([]);
	});
});
