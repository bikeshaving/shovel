export const calls: {
	url: string | undefined;
	options: Record<string, unknown> | undefined;
	driver: string | undefined;
	close: number;
};

export function reset(): void;

export class NamedDriver {
	constructor(url: string, options?: Record<string, unknown>);
	close(): Promise<void>;
}

declare class DefaultDriver {
	constructor(url: string, options?: Record<string, unknown>);
	close(): Promise<void>;
}

export default DefaultDriver;
