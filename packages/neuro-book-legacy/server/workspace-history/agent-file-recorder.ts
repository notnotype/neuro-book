import {
    requireReadyModuleHandle,
} from "nbook/server/runtime/product-project";
import type {ResolvedFileTarget} from "nbook/server/workspace-files/authorized-file-operation";
import {
    PROJECT_FILE_INDEX_MODULE_TOKEN,
    type ProjectFileIndexHandle,
} from "nbook/server/workspace-files/project-file-index";
import {
    PROJECT_HISTORY_MODULE_TOKEN,
    recordProjectDelete,
    recordProjectWrite,
    type ProjectHistoryHandle,
} from "nbook/server/workspace-history/project-history";

/**
 * Agent 文件工具（write / edit / apply_patch）的文件历史归因记账（Task 95 S5）。
 *
 * 项目归属直接消费文件授权边界捕获的 exact Project generation。通过显式
 * `workspace/<其他slug>/...` 跨项目写文件时，历史层不得再从物理路径反推身份。
 * 无 Project 归属的地址一律静默跳过；
 * 记账本身 fail-open（record* 内部保证），绝不影响工具主流程。
 */

/** 归一 before/after 入参：string 按 UTF-8 编码为字节。 */
function toRecordBytes(content: string | Uint8Array | null): Uint8Array | null {
    if (content === null) {
        return null;
    }
    return typeof content === "string" ? new TextEncoder().encode(content) : content;
}

/**
 * 记一次 agent 工具写入。调用方必须在 Project File Index mutation gate 内完成落盘与记账。
 * after = null 表示删除（此时 before 必须有内容才有账可记）。
 * before = null 表示写前文件不存在（file.create 语义）。
 */
export async function recordAgentWorkspaceWrite(input: {
    sessionId: number;
    capture: AgentWorkspaceWriteCapture | null;
    before: string | Uint8Array | null;
    after: string | Uint8Array | null;
}): Promise<void> {
    if (!input.capture) {
        return;
    }
    try {
        const {history, relativePath} = input.capture;
        // N5：sessionId number→string 集中在此转换，模块侧 actor 恒为 string
        const actor = {kind: "agent" as const, sessionId: String(input.sessionId)};
        const after = toRecordBytes(input.after);
        if (after === null) {
            const before = toRecordBytes(input.before);
            if (before !== null) {
                await recordProjectDelete(history, {
                    relativePath,
                    actor,
                    before,
                });
            }
        } else {
            await recordProjectWrite(history, {
                relativePath,
                actor,
                before: toRecordBytes(input.before),
                after,
            });
        }
    } catch {
        // History generation可能在文件落盘后、记账前关闭；记账永远不能反向破坏文件写入。
    }

}

/** 落盘前捕获的目标 Project generation 记账上下文。 */
export type AgentWorkspaceWriteCapture = Readonly<{
    history: ProjectHistoryHandle;
    fileIndex: ProjectFileIndexHandle;
    relativePath: string;
}>;

/**
 * 在文件 mutation 前从已授权目标捕获精确 History handle。
 * 非 Project 地址返回 null；落盘后不得再次查询当前 generation。
 */
export function captureAgentWorkspaceWrite(
    target: ResolvedFileTarget,
): AgentWorkspaceWriteCapture | null {
    const exactProject = target.project;
    const relativePath = target.relativePath;
    if (!exactProject || !relativePath || relativePath === ".") {
        return null;
    }
    try {
        const history = requireReadyModuleHandle(
            exactProject,
            PROJECT_HISTORY_MODULE_TOKEN,
        );
        const fileIndex = requireReadyModuleHandle(
            exactProject,
            PROJECT_FILE_INDEX_MODULE_TOKEN,
        );
        return Object.freeze({history, fileIndex, relativePath});
    } catch {
        return null;
    }
}
