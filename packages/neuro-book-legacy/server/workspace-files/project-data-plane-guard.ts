import type {ResolvedFileTarget} from "nbook/server/workspace-files/authorized-file-operation";
import {
    requireActiveReadyProject,
    requireReadyModuleHandle,
    runReadyProjectOperation,
} from "nbook/server/runtime/product-project";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import {PROJECT_FILE_INDEX_MODULE_TOKEN} from "nbook/server/workspace-files/project-file-index";

/**
 * 在任何文件 I/O 前，为目标携带的 exact Project generation 登记数据面操作。
 *
 * 多文件 patch 可以同时触及多个 Project；同一 generation 只登记一次。没有 Project
 * 归属的 Workspace Root 与绝对地址直接执行。
 */
export function runProjectFileOperation<TResult>(
    targets: readonly ResolvedFileTarget[],
    operation: () => Promise<TResult>,
): Promise<TResult> {
    const projects = uniqueReadyProjects(targets);
    const enter = (index: number): Promise<TResult> => {
        const project = projects[index];
        if (!project) {
            return operation();
        }
        const current = requireActiveReadyProject(project.workspace.ref);
        if (current !== project) {
            return Promise.reject(new Error(`Project generation 已失效：${project.workspace.ref.projectRoot}`));
        }
        return runReadyProjectOperation(project, async () => enter(index + 1));
    };
    return enter(0);
}

/**
 * 在 exact Project generation operation 内串行取得每个目标的 File Index mutation gate。
 *
 * 多 Project patch 按稳定 workspace key 顺序取得 gate，避免两个反向 patch 形成锁顺序死锁。
 * 没有 Project 归属的 Workspace Root 与绝对地址直接执行。
 */
export function runProjectFileMutation<TResult>(
    targets: readonly ResolvedFileTarget[],
    operation: () => Promise<TResult>,
): Promise<TResult> {
    const projects = uniqueReadyProjects(targets)
        .sort((left, right) => String(left.workspace.key).localeCompare(String(right.workspace.key)));
    const enter = (index: number): Promise<TResult> => {
        const project = projects[index];
        if (!project) {
            return operation();
        }
        const current = requireActiveReadyProject(project.workspace.ref);
        if (current !== project) {
            return Promise.reject(new Error(`Project generation 已失效：${project.workspace.ref.projectRoot}`));
        }
        return runReadyProjectOperation(project, () => {
            const fileIndex = requireReadyModuleHandle(project, PROJECT_FILE_INDEX_MODULE_TOKEN);
            return fileIndex.mutate(() => enter(index + 1));
        });
    };
    return enter(0);
}

/** 按 ReadyProjectSessionRef 对象身份稳定去重。 */
function uniqueReadyProjects(targets: readonly ResolvedFileTarget[]): ReadyProjectSessionRef[] {
    const projects = new Set<ReadyProjectSessionRef>();
    for (const target of targets) {
        if (target.project) {
            projects.add(target.project);
        }
    }
    return [...projects];
}
