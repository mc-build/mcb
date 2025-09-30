import { Test, SourceFile } from "./Test";
import * as fs from "fs";
import * as path from "path";
import { FeatureFlags } from "../mcl/FeatureFlags";

export class TestBuilder {
  static getTests(): Test[] {
    const cwd = process.cwd();
    const testsDir = path.join(cwd, "tests");
    const dirs = fs
      .readdirSync(testsDir)
      .filter((entry) => fs.statSync(path.join(testsDir, entry)).isDirectory())
      .sort();
  const versions = FeatureFlags.getAvailableVersions();
    const tests: Test[] = [];
    for (const dir of dirs) {
      const dirPath = path.join(testsDir, dir);
      const resultFilePath = path.join(dirPath, "result");
      const sourceDirPath = path.join(dirPath, "source");
      let configPath: string | null = null;
      if (fs.existsSync(path.join(dirPath, "env.js"))) {
        configPath = path.join(dirPath, "env.js");
      }
      const sources: SourceFile[] = [];
      for (const entry of fs.readdirSync(sourceDirPath).sort()) {
        const filePath = path.join(sourceDirPath, entry);
        if (!fs.statSync(filePath).isFile()) {
          continue;
        }
        sources.push({
          path: entry,
          content: fs.readFileSync(filePath, "utf8"),
        });
      }
      const expectedResult = new Map<number, string>();
      for (const v of versions) {
        const resultFile = path.join(resultFilePath, `${v}.txt`);
        if (fs.existsSync(resultFile)) {
          expectedResult.set(v, fs.readFileSync(resultFile, "utf8"));
        }
      }
      tests.push({
        name: dir,
        sources,
        expectedResult,
        resultPath: resultFilePath,
        configPath,
      });
    }
    return tests;
  }
}
