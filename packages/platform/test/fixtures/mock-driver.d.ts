export let lastUrl: string | undefined;
export let lastOptions: Record<string, unknown> | undefined;
export let lastDriver: string | undefined;
export let closeCalls: number;

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
