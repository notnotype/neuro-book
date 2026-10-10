import {describe, expect, test} from "bun:test";
import {resolve} from "node:path";

const packageRoot = resolve(import.meta.dir, "..");

/** 示例即 smoke：以独立进程运行，确认 TSX Profile 可加载、渲染结果符合示例说明。 */
describe("examples", () => {
    test("render-profile.ts 加载 TSX 并对比 If 开关", () => {
        const run = Bun.spawnSync(["bun", "examples/render-profile.ts"], {cwd: packageRoot, stdout: "pipe", stderr: "pipe"});
        const stdout = run.stdout.toString();

        expect(run.exitCode, run.stderr.toString()).toBe(0);
        expect(stdout).toContain('"回答使用简体中文。\\n先给结论，再给理由。"');
        expect(stdout).toContain("reviewMode=false：系统段 1 段，消息 2 条");
        expect(stdout).toContain("reviewMode=true：系统段 2 段，消息 2 条");
    });
});
