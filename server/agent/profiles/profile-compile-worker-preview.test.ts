import {cp, mkdir, readFile, readdir, rm, stat} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {ProfileCompileWorkerService} from "nbook/server/agent/profiles/profile-compile-worker";
import {runProfileCompile} from "nbook/server/agent/profiles/profile-compile-worker-runtime";
import type {ProfileCompileWorkerResult} from "nbook/server/agent/profiles/profile-compile-worker-types";
import {withIsolatedWorkspaceAssets, type IsolatedWorkspaceAssets} from "nbook/server/workspace-files/test-workspace-fixture";

describe("profile compile worker preview 与 lifecycle", () => {
    // 原「源码覆盖编译不写入全局 profile module cache」用例已删除（Task 125）。
    // 它守的 `.agent/profile-module-cache` 全仓再无任何写入方，断言恒真；
    // 而且它按 cwd 相对解析，实际是在 rm/mkdir 真实仓库目录。dry-run 不写真实
    // 用户源码与 `.compiled` 由本文件后面的 preview 用例覆盖。

    it("worker crash 返回结构化 issue，不向 endpoint 抛 rejected promise", async () => {
        const worker = new ProfileCompileWorkerService("test-crash");
        const running = worker.compile({
            fileName: "builtin/leader.default.profile.tsx",
            source: "export default null;",
            dryRun: false,
            preview: false,
        });

        worker.dispose();
        const result = await running;

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            stale: false,
            detail: null,
        }));
        expect(result.issues).toEqual([
            expect.objectContaining({
                severity: "error",
                code: "compile_worker_failed",
                fileName: "builtin/leader.default.profile.tsx",
            }),
        ]);
    });

    it("dry-run preview 不写入真实用户源码或 compiled artifact", async () => {
        await withProfileAssets(["builtin/leader.default.profile.tsx"], async (assets) => {
            const fileName = "builtin/leader.default.profile.tsx";
            const sourcePath = profilePath(assets, fileName);
            const source = await readFile(sourcePath, "utf8");
            const compiledManifest = resolve(assets.userProfileRoot, ".compiled", "manifest.json");
            await rm(compiledManifest, {force: true});
            const result = await runProfileCompile({
                fileName,
                source: source.replace("Neuro Book", "Dry Run Neuro Book"),
                dryRun: true,
                preview: true,
                userProfileRoot: assets.userProfileRoot,
            });

            expect(result.ok).toBe(true);
            expect(result.preview?.ok).toBe(true);
            await expect(readFile(sourcePath, "utf8")).resolves.toBe(source);
            await expect(pathExists(compiledManifest)).resolves.toBe(false);
        });
    }, 120_000);

});

/** 在隔离Workspace Root中只复制当前测试需要的Profile源码。 */
async function withProfileAssets(
    fileNames: string[],
    run: (assets: IsolatedWorkspaceAssets) => Promise<void>,
): Promise<void> {
    await withIsolatedWorkspaceAssets({}, async (assets) => {
        for (const fileName of fileNames) {
            const target = resolve(assets.userProfileRoot, fileName);
            await mkdir(dirname(target), {recursive: true});
            await cp(resolve(assets.systemProfileRoot, fileName), target, {force: true});
        }
        await run(assets);
    });
}

/** 清理未发布的Profile staging目录。 */
async function cleanupStagedResult(result: ProfileCompileWorkerResult): Promise<void> {
    if (result.stagedRelease) {
        await rm(result.stagedRelease.buildCompiledDir, {recursive: true, force: true});
    }
}

/** 判断测试文件是否存在。 */
async function pathExists(filePath: string): Promise<boolean> {
    try {
        await stat(filePath);
        return true;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

/** 返回隔离用户Profile的物理路径。 */
function profilePath(assets: IsolatedWorkspaceAssets, fileName: string): string {
    return resolve(assets.userProfileRoot, ...fileName.split("/"));
}
