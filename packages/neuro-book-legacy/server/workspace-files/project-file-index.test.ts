import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import { testAbsoluteFsPath } from "@notnotype/neuro-book-test-support/test-path"
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";
import {
    ProjectFileIndexAdapter,
    type ProjectFileIndexBuild,
} from "nbook/server/workspace-files/project-file-index";

type ProjectFileIndexBuildResult = Awaited<ReturnType<ProjectFileIndexBuild>>;

describe("ProjectFileIndexAdapter warm-up", () => {
    it("warm-up 失败进入 cache diagnostics，下一批 read 共享一次重试", async () => {
        const workspaceRoot = absoluteFsPath(testHostPath("project-file-index-warmup-test"));
        const ref = projectWorkspaceRef("novel-a");
        const workspace = resolvedProjectWorkspace(
            ref,
            absoluteFsPath(path.join(workspaceRoot, ref.projectRoot)),
            createProjectWorkspaceKey(workspaceRoot, ref),
        );
        const warmupFailure = new Error("warm-up scan failed");
        let resolveRetry!: (result: ProjectFileIndexBuildResult) => void;
        const retry = new Promise<ProjectFileIndexBuildResult>((resolve) => {
            resolveRetry = resolve;
        });
        let buildCount = 0;
        const adapter = new ProjectFileIndexAdapter({
            build: async () => {
                buildCount += 1;
                if (buildCount === 1) {
                    throw warmupFailure;
                }
                return retry;
            },
            openWatcher: () => ({close: () => undefined}),
        });
        const controller = new AbortController();
        const handle = adapter.startProject({
            workspace,
            signal: controller.signal,
            onRawEvents: () => undefined,
        });

        try {
            await handle.ready;
            await waitFor(() => diagnostic(adapter)?.buildFailureCount === 1);

            expect(diagnostic(adapter)).toMatchObject({
                dirty: true,
                building: false,
                buildCount: 1,
                buildFailureCount: 1,
                lastBuildError: "Error: warm-up scan failed",
            });

            const reads = Array.from({length: 50}, () => handle.read());
            await waitFor(() => buildCount === 2);
            expect(diagnostic(adapter)).toMatchObject({
                building: true,
                buildCount: 2,
                buildFailureCount: 1,
            });

            resolveRetry({nodes: [], issues: []});
            const snapshots = await Promise.all(reads);

            expect(buildCount).toBe(2);
            expect(snapshots.every((snapshot) => snapshot.revision === 1)).toBe(true);
            expect(diagnostic(adapter)).toMatchObject({
                dirty: false,
                building: false,
                buildFailureCount: 1,
                stableCommitCount: 1,
            });
        } finally {
            controller.abort();
            await handle.close();
        }
    });
});

/** 返回测试 Adapter 唯一 entry 的 package 诊断。 */
function diagnostic(adapter: ProjectFileIndexAdapter): ReturnType<ProjectFileIndexAdapter["diagnostics"]>["entries"][string] | undefined {
    return Object.values(adapter.diagnostics().entries)[0];
}

/** 等待 warm-up/retry 微任务到达确定状态。 */
async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
    const startedAt = performance.now();
    while (!predicate()) {
        if (performance.now() - startedAt > timeoutMs) {
            throw new Error(`condition did not become true within ${timeoutMs}ms`);
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
}
