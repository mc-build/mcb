export class TestIo {
  private files: Map<string, string> = new Map();

  write(path: string, content: string) {
    if (this.files.has(path)) {
      console.debug();
      console.warn(`Warning: overwriting file ${path}`);
    }
    this.files.set(path, content);
  }

  cleanup() {}

  finished(): boolean {
    return true;
  }

  print(): string {
    let result = "";
    for (const [k, v] of this.files.entries()) {
      result += `${k}:\n${v}\n----------------\n`;
    }
    return result;
  }

  reportFilesRemoved(_oldFiles: Map<string, string>): string[] {
    return [];
  }

  reportFilesAdded(_oldFiles: Map<string, string>): string[] {
    return [];
  }

  reportFilesChanged(_oldFiles: Map<string, string>): string[] {
    return [];
  }

  reportFileMetadata(): Map<string, string> {
    return new Map();
  }
}
