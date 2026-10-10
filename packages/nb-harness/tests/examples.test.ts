import {describe, expect, test} from "bun:test";
import {resolve} from "node:path";

const packageRoot = resolve(import.meta.dir, "..");

/**
 * 示例即 smoke：以独立进程运行不调用真实模型的示例。
 * real-model.ts 会产生计费调用，不在这里自动运行；真实模型由 harness.llm.test.ts 覆盖。
 */
function runExample(file: string): string {
    const run = Bun.spawnSync(["bun", file], {cwd: packageRoot, stdout: "pipe", stderr: "pipe"});
    expect(run.exitCode, run.stderr.toString()).toBe(0);
    return run.stdout.toString();
}

describe("examples", () => {
    test("offline-turn.ts：插件工具进入工具集，两轮对话落盘并可读回", () => {
        const stdout = runExample("examples/offline-turn.ts");

        expect(stdout).toContain('工具： [ "read", "edit", "word_count" ]');
        expect(stdout).toContain('第二轮新增条目： [ "3:message", "4:message" ]');
        expect(stdout).toContain("事件首尾： agent_start … agent_end");
    });

    test("file-tools.ts：先读后改成功，伪造锚点与写前确认被拒绝", () => {
        const stdout = runExample("examples/file-tools.ts");

        expect(stdout).toContain('磁盘内容： "# 第一章\\n林照推开门。\\n雨停了。\\n"');
        expect(stdout).toContain("伪造锚点 isError： true");
        expect(stdout).toContain("写前确认拒绝： 已拒绝写入：chapter.md");
    });

    test("sse-stream.ts：客户端经 SSE 收到完整的一轮 agent 事件", () => {
        const stdout = runExample("examples/sse-stream.ts");

        expect(stdout).toContain("content-type： text/event-stream; charset=utf-8");
        expect(stdout).toMatch(/"agent_start"[\s\S]*"agent_end"/u);
    });
});
