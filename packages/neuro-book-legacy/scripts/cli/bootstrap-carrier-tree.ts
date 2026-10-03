import fs from "node:fs/promises";
import {startProductRuntime} from "nbook/server/runtime/product-startup";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {PROJECT_PLOT_WORLD_MODULE_TOKEN} from "nbook/server/plot";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {
    activateReadyProjectModule,
    closeProject,
    openProject,
} from "nbook/server/runtime/product-project";

/**
 * 承载树 Bootstrap CLI。
 *
 * 把现有 Project Workspace 的 manuscript 目录结构导入 Plot 两棵树的承载侧:
 * 为每个 volume 目录建 StoryAct、每个 chapter 目录建 StoryChapter,并向 Prose 的 index.md
 * frontmatter 写入 `chapter: <name>` 反指。Scene.chapterPath → chapterId 的 DB 迁移由
 * initProjectDatabase 自动完成(facade 调用会先触发),本 CLI 只补承载树实体与文件指针。
 *
 * 幂等:同 name 的 Act/Chapter 不重建,已有 chapter 指针的 Prose 不改写,可反复运行。
 *
 * 用法:
 *   bun scripts/cli/bootstrap-carrier-tree.ts ming-ding-zhi-shi-2
 *   bun scripts/cli/bootstrap-carrier-tree.ts --all            # 扫描 workspace/ 下全部项目
 */
async function main(): Promise<number> {
    if (!process.env.NEURO_BOOK_APPLICATION_ROOT?.trim() || !process.env.NEURO_BOOK_STATE_ROOT?.trim()) {
        throw new Error("Bootstrap CLI要求显式NEURO_BOOK_APPLICATION_ROOT与NEURO_BOOK_STATE_ROOT");
    }
    const workspaceRoot = runtimePathsFromEnv().workspaceRoot;
    const args = process.argv.slice(2);
    const projectRoots = args.includes("--all")
        ? await collectWorkspaceProjects(workspaceRoot)
        : args.filter((arg) => !arg.startsWith("--"));
    if (projectRoots.length === 0) {
        console.log("用法: bun scripts/cli/bootstrap-carrier-tree.ts <project-root ...> | --all");
        return 1;
    }
    const runtime = startProductRuntime();
    await runtime.ready;
    try {
        let hadError = false;
        for (const projectRoot of projectRoots) {
            console.log(`\n▸ ${projectRoot}`);
            const ref = projectWorkspaceRef(projectRoot);
            try {
                const ready = await openProject(ref, {kind: "job", source: "bootstrap-carrier-tree"});
                const handle = await activateReadyProjectModule(ready, PROJECT_PLOT_WORLD_MODULE_TOKEN);
                const result = await handle.plot.bootstrapCarrierTree();
                console.log(`  Act 新建 ${result.actsCreated}、Chapter 新建 ${result.chaptersCreated}、补卷归属 ${result.chaptersLinkedToAct}`);
                console.log(`  Prose frontmatter 写回 ${result.proseFrontmatterWritten.length} 处`);
                for (const written of result.proseFrontmatterWritten) console.log(`    + ${written}`);
                for (const warning of result.warnings) console.warn(`  ! ${warning}`);
            } catch (error) {
                hadError = true;
                console.error(`  ✗ 失败: ${error instanceof Error ? error.message : String(error)}`);
            } finally {
                try {
                    await closeProject(ref, "shutdown");
                } catch (error) {
                    hadError = true;
                    console.error(`  ✗ Project关闭失败: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
        return hadError ? 1 : 0;
    } finally {
        await runtime.stop();
    }
}

/**
 * 扫描 workspace/ 下的一级项目目录(跳过隐藏目录)。
 */
async function collectWorkspaceProjects(workspaceRoot: string): Promise<string[]> {
    const entries = await fs.readdir(workspaceRoot, {withFileTypes: true}).catch(() => []);
    return entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort();
}

// 关闭Product后保留完整退出状态。
try {
    process.exitCode = await main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
