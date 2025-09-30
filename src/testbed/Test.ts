export interface SourceFile {
  path: string;
  content: string;
}

export interface Test {
  sources: SourceFile[];
  name: string;
  expectedResult: Map<number, string>;
  resultPath: string;
  configPath: string | null;
}
