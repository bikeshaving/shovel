/**
 * IDBVersionChangeEvent implementation.
 */

export class IDBVersionChangeEvent extends Event {
	readonly oldVersion: number;
	readonly newVersion: number | null;

	constructor(
		type: string,
		options: {oldVersion: number; newVersion: number | null},
	) {
		super(type, {bubbles: false, cancelable: false});
		this.oldVersion = options.oldVersion;
		this.newVersion = options.newVersion;
	}
}
