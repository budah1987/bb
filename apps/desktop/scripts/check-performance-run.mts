import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateDesktopPerformanceRun } from "../src/desktop-performance-budget.js";

const artifactPath = process.argv[2];
if (artifactPath === undefined) {
  throw new Error(
    "Usage: pnpm --dir apps/desktop performance:check <performance-run.json>",
  );
}

const packageRoot = process.cwd();
const [runText, budgetsText] = await Promise.all([
  readFile(resolve(packageRoot, artifactPath), "utf8"),
  readFile(resolve(packageRoot, "../../performance-budgets.json"), "utf8"),
]);
const evaluation = evaluateDesktopPerformanceRun(
  JSON.parse(runText),
  JSON.parse(budgetsText),
);

process.stdout.write(`${JSON.stringify(evaluation, null, 2)}\n`);
if (!evaluation.passed) process.exitCode = 1;
