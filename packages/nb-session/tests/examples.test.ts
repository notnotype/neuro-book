import {describe, expect, test} from "bun:test";
import {resolve} from "node:path";

const packageRoot = resolve(import.meta.dir, "..");

/** 示例即 smoke：以独立进程运行，确认包入口可导入且示例能完整跑完。 */
describe("examples", () => {
    test("jsonl-log.ts 跑完三个阶段", () => {
        const run = Bun.spawnSync(["bun", "examples/jsonl-log.ts"], {cwd: packageRoot, stdout: "pipe", stderr: "pipe"});
        const stdout = run.stdout.toString();

        expect(run.exitCode, run.stderr.toString()).toBe(0);
        expect(stdout).toContain("追加的 seq： [ 2, 3, 4, 5 ]");
        expect(stdout).toContain("重开后的下一条 seq： 6");
        expect(stdout).toContain("中断尾时 append： 被拒绝");
        expect(stdout).toContain("修复后的下一条 seq： 7");
    });
});
