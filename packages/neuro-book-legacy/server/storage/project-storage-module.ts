/**
 * Project Storage lazy Module。
 *
 * start 只捕获本 generation 的 Storage 根：接入不依赖 I/O，普通 Project open 不建立目录、不解析任何状态记录，
 * 建根与值动作都在各自的操作内进行。close 失效本 scope 已经签发的访问上下文并释放容量，
 * 使迟到的句柄在下一个真实副作用前失败；已接纳的动作由 Project 数据面在 Module close 之前收口。
 */

import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {projectStorageRootFromProjectRoot} from "nbook/server/storage/storage-address";
import {revokeStorageProjectScope} from "nbook/server/storage/host";
import {
    projectModuleToken,
    registerProjectModule,
    type ProjectModule,
    type ProjectModuleHandle,
} from "nbook/server/workspace-files/project-module";

/** 本 generation 的 Project Storage 句柄；storageRoot 由发送门禁与 ready 目录共同确定。 */
export type ProjectStorageModuleHandle = ProjectModuleHandle & {
    readonly storageRoot: AbsoluteFsPath;
};

export const PROJECT_STORAGE_MODULE_TOKEN = projectModuleToken<ProjectStorageModuleHandle>("storage", "lazy");

export const projectStorageModule: ProjectModule<ProjectStorageModuleHandle> = {
    token: PROJECT_STORAGE_MODULE_TOKEN,
    start({prepared}) {
        const storageRoot = projectStorageRootFromProjectRoot(prepared.workspace.root);
        let closed = false;
        return {
            storageRoot,
            ready: Promise.resolve(),
            close(): Promise<void> {
                if (closed) {
                    return Promise.resolve();
                }
                closed = true;
                revokeStorageProjectScope(storageRoot);
                return Promise.resolve();
            },
        };
    },
};

registerProjectModule(projectStorageModule);
