export class SourceRegistry {
	private static sources = new Map<string, string[]>();

	static register(file: string, code: string): void {
		if (!SourceRegistry.sources.has(file)) {
			SourceRegistry.sources.set(file, code.split(/\r\n|\r|\n/));
		}
	}

	static getLine(file: string, line: number): string | undefined {
		return SourceRegistry.sources.get(file)?.[line - 1];
	}
}
