import {
    requireReadyModuleHandle,
} from "nbook/server/runtime/product-project";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import {
    PROJECT_FILE_INDEX_MODULE_TOKEN,
    type ProjectFileIndexHandle,
} from "nbook/server/workspace-files/project-file-index";
import {
    LOCAL_USER_ID,
    PROJECT_HISTORY_MODULE_TOKEN,
    recordProjectDelete,
    recordProjectWrite,
    type ProjectHistoryHandle,
} from "nbook/server/workspace-history/project-history";

/** 用户文件 mutation 落盘前捕获的精确 Project generation 资源。 */
export type UserProjectFileWriteCapture = Readonly<{
    history: ProjectHistoryHandle;
    fileIndex: ProjectFileIndexHandle;
    relativePath: string;
}>;

/**
 * 在用户文件 mutation 落盘前捕获同一个 ready generation 的 History 与 File Index。
 * ready 已过期时直接拒绝 mutation，调用方不得退回字符串 Project Path 查询当前 generation。
 */
export function captureUserProjectFileWrite(
    ready: ReadyProjectSessionRef,
    relativePath: string,
): UserProjectFileWriteCapture {
    return Object.freeze({
        history: requireReadyModuleHandle(ready, PROJECT_HISTORY_MODULE_TOKEN),
        fileIndex: requireReadyModuleHandle(ready, PROJECT_FILE_INDEX_MODULE_TOKEN),
        relativePath,
    });
}

/**
 * 为已经落盘的用户文件 mutation 记账。
 * 调用方必须在 capture.fileIndex.mutate() 内完成落盘；History 记账保持 fail-open。
 */
export async function recordUserProjectFileWrite(input: {
    capture: UserProjectFileWriteCapture;
    before: string | Uint8Array | null;
    after: string | Uint8Array | null;
}): Promise<void> {
    try {
        const actor = {kind: "user" as const, userId: LOCAL_USER_ID};
        const after = toRecordBytes(input.after);
        if (after === null) {
            const before = toRecordBytes(input.before);
            if (before !== null) {
                await recordProjectDelete(input.capture.history, {
                    relativePath: input.capture.relativePath,
                    actor,
                    before,
                });
            }
        } else {
            await recordProjectWrite(input.capture.history, {
                relativePath: input.capture.relativePath,
                actor,
                before: toRecordBytes(input.before),
                after,
            });
        }
    } catch {
        // History关闭或记账失败只损失即时归因，后台对账仍可补为external。
    }
}

/** 把文本输入按 UTF-8 转为 History 使用的字节快照。 */
function toRecordBytes(content: string | Uint8Array | null): Uint8Array | null {
    if (content === null) {
        return null;
    }
    return typeof content === "string" ? new TextEncoder().encode(content) : content;
}
