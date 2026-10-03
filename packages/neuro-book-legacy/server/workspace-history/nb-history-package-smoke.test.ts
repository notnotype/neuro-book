import fs from "node:fs/promises";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import path from "node:path";
import {afterAll, describe, expect, it} from "vitest";
import {WorkspaceHistory} from "@notnotype/nb-history";

/**
 * nb-history workspace 包冒烟测试：验证正式包入口在 NeuroBook 类型环境与测试运行时中
 * 全链路可用（open → 写入 → 时间线 → diff → close → Windows 句柄释放到「库文件可删」）。
 * 完整行为契约（T1–T12）在包自身测试中覆盖，这里不重复。
 */
describe("nb-history workspace 包冒烟", () => {
    const tempRoots: string[] = [];

    afterAll(async () => {
        for (const root of tempRoots) {
            await fs.rm(root, {recursive: true, force: true}).catch(() => undefined);
        }
    });

    it("open → performWrite → timeline → textDiff → close → 库文件可删", async () => {
        const workspaceRoot = await fs.mkdtemp(testHostPath("nb-history-package-smoke-"));
        tempRoots.push(workspaceRoot);
        const databasePath = path.join(workspaceRoot, ".nbook", "history.sqlite");
        await fs.mkdir(path.dirname(databasePath), {recursive: true});

        const history = await WorkspaceHistory.open({
            databasePath,
            resolvePath: (relativePath) => path.join(workspaceRoot, ...relativePath.split("/")),
        });
        const created = await history.performWrite({kind: "user", userId: "local"}, "manuscript/ch1.md", "第一版正文\n");
        expect(created.operation.type).toBe("file.create");
        const edited = await history.performWrite({kind: "agent", sessionId: "42"}, "manuscript/ch1.md", "第二版正文\n多了一行\n");
        expect(edited.operation.type).toBe("file.edit");
        expect(await fs.readFile(path.join(workspaceRoot, "manuscript/ch1.md"), "utf-8")).toBe("第二版正文\n多了一行\n");

        const timeline = await history.timeline("manuscript/ch1.md");
        expect(timeline.map((item) => item.entry.operation.type)).toEqual(["file.create", "file.edit"]);

        // textDiff 走 nb-history 包声明的 diff 依赖，验证主应用消费正式入口时可用。
        const editOperation = edited.operation;
        if (editOperation.type !== "file.edit") {
            throw new Error("预期 file.edit 操作");
        }
        const diff = await history.textDiff(editOperation.beforeHash, editOperation.afterHash);
        expect(diff.available).toBe(true);
        if (!diff.available) {
            throw new Error("预期 diff 可用");
        }
        expect(diff.changes.length).toBeGreaterThan(0);
        expect(diff.afterText).toBe("第二版正文\n多了一行\n");

        const runtimeEntry = await history.performWrite(
            {kind: "system", source: "package-smoke"},
            "runtime-artifact-import-cache/example.mjs",
            "export {};\n",
        );
        const purge = await history.purgePaths((recordedPath) => recordedPath.startsWith("runtime-artifact-import-cache/"));
        expect(purge.entriesDeleted).toBe(1);
        expect(await history.timeline("runtime-artifact-import-cache/example.mjs")).toHaveLength(0);
        if (runtimeEntry.operation.type !== "file.create") {
            throw new Error("预期 runtime artifact 为 file.create");
        }
        expect(await history.snapshotBody(runtimeEntry.operation.afterHash)).toBeNull();

        await history.close();
        // 「close 后立即可删库文件」只在 bun 运行时是模块承诺(close 内建强制 GC 收敛句柄);
        // vitest worker 跑在 node 运行时时无强制 GC,只能等自然 GC——删除断言降级为 best-effort,
        // 严格的 Windows 句柄验收由 nb-history 包自身的 bun test(T12)覆盖。
        const hasBunGc = typeof (globalThis as {Bun?: {gc?: unknown}}).Bun?.gc === "function";
        if (hasBunGc) {
            await expectFileDeletable(databasePath);
        } else {
            await fs.rm(databasePath, {force: true}).catch(() => undefined);
        }
    }, 15_000);
});

/**
 * close 后库文件应可删除（Windows 句柄释放验收）。bun 运行时下 close() 内建强制 GC 即刻收敛；
 * 非 bun 运行时依赖自然 GC，留重试窗口兜底。
 */
async function expectFileDeletable(filePath: string): Promise<void> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 25; attempt++) {
        try {
            await fs.rm(filePath, {force: true});
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }
    throw new Error(`close 后库文件仍不可删除(句柄未释放): ${String(lastError)}`);
}
