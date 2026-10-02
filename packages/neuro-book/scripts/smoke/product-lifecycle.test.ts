import {execFile} from "node:child_process";
import {resolve} from "node:path";
import {promisify} from "node:util";
import {describe, expect, it} from "vitest";

const execFileAsync = promisify(execFile);
const source = resolve(import.meta.dirname, "product-lifecycle.ts");

async function runDecision(results: string[], workflowFailed = false): Promise<number> {
    const script = `import {exitCodeForReports} from ${JSON.stringify(source)}; process.exit(exitCodeForReports(${JSON.stringify(results.map((result) => ({result})))}, ${String(workflowFailed)}));`;
    try {
        await execFileAsync("bun", ["--no-install", "--no-env-file", "--eval", script]);
        return 0;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "number") return error.code;
        throw error;
    }
}

describe("product lifecycle smoke exit", () => {
    it("全部选中检查通过时退出码为 0", async () => {
        expect(await runDecision(["pass", "pass"])).toBe(0);
    });
    it("存在 pending 时退出码为非零", async () => {
        expect(await runDecision(["pass", "pending"])).toBe(1);
    });
    it("存在 fail 时退出码为非零", async () => {
        expect(await runDecision(["fail"])).toBe(1);
    });
    it("主流程异常即使已有报告全部 pass 也以非零退出", async () => {
        expect(await runDecision(["pass"], true)).toBe(1);
    });
});
