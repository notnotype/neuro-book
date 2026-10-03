import {spawn} from "node:child_process";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";

const applicationRoot = resolve(import.meta.dirname, "..", "..", "..");

describe("sqlite-vec smoke", () => {
    it("Bun runtime 能加载 sqlite-vec 并执行 vec0 查询", async () => {
        const result = await runBunScript(resolve(applicationRoot, "scripts", "smoke", "sqlite-vec.ts"));

        expect(result.exitCode).toBe(0);
        expect(result.output).toContain("sqlite-vec smoke ok");
    }, 20_000);

    it("Bun runtime 能跑通 subject RAG 索引和检索", async () => {
        const result = await runBunScript(resolve(applicationRoot, "scripts", "smoke", "subject-rag.ts"));

        expect(result.exitCode).toBe(0);
        expect(result.output).toContain("subject-rag smoke ok");
    }, 20_000);
});

function runBunScript(scriptPath: string): Promise<{exitCode: number | null; output: string}> {
    return new Promise((resolvePromise, reject) => {
        const child = spawn("bun", [scriptPath], {
            cwd: applicationRoot,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        let output = "";
        child.stdout.on("data", (chunk: Buffer) => {
            output += chunk.toString("utf-8");
        });
        child.stderr.on("data", (chunk: Buffer) => {
            output += chunk.toString("utf-8");
        });
        child.once("error", reject);
        child.once("close", (exitCode) => {
            resolvePromise({exitCode, output});
        });
    });
}
