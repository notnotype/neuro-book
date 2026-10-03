import {readFile} from "node:fs/promises";
import {
    assertRealPathContained,
    resolveContainedFilePath,
} from "nbook/server/runtime/paths/file-path";
import type {WorkspacePort} from "@notnotype/nb-workflow";
import type {ResolvedProjectWorkspace} from "nbook/server/workspace-files/project-identity";

/**
 * 从调用入口捕获的 Project Workspace 构造 workflow 只读端口。
 *
 * `wf.workspace.read()` 只接受当前 Project Workspace 内的路径；每次读取都会执行
 * lexical 与 realpath containment，但不会再按旧 Project Path 查找另一个 generation。
 */
export function createProjectWorkflowWorkspace(
    workspace: ResolvedProjectWorkspace,
): WorkspacePort {
    return {
        read: async (path: string): Promise<string> => {
            const target = resolveContainedFilePath(workspace.root, path);
            await assertRealPathContained(workspace.root, target);
            return await readFile(target, "utf8");
        },
    };
}
