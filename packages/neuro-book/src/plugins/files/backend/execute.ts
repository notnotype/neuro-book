/**
 * 在一个根上执行一次已接纳的写请求：登记为在途操作、落盘、记来源、发变更、交回公共结果。浏览器的远程合同、服务端文件服务
 * 的 `user://` 与挂载方案共用这一份，保存规则不各写一遍（docs/specs/workspace/resources.md、files.md）。
 */

import type {Scope} from "@notnotype/nb-runtime/lifecycle";

import type {Baseline, OperationDone, SavedText} from "../shared/contracts";
import type {ServerFilesResult} from "../shared/schemes";
import type {ChangeHub, Origin} from "./changes";
import {createDirectory, createFile} from "./entry-ops";
import type {FilesService, Outcome} from "./files-service";
import type {RootedFailure, RootedRoot} from "./rooted";

/**
 * 写方法登记为提供入口作用域上的在途操作：入口停止时等它实际结束才关闭，不在关闭之后继续改用户的文件
 * （docs/specs/workspace/files.md 的“停止与取消”）。
 */
export async function tracked<T>(scope: Scope, label: string, run: () => Promise<T>): Promise<T> {
    let value: {readonly result: T} | null = null;
    const handle = scope.accept({label, run: async () => {
        value = {result: await run()};
    }});
    const ended = await handle.termination;
    if (ended.status === "failed") throw ended.error;
    return (value as {readonly result: T} | null)?.result as T;
}

export interface WriteTarget {
    readonly root: RootedRoot;
    readonly service: FilesService;
    readonly changes: ChangeHub;
    readonly scope: Scope;
}

/** 按基线保存；成功后以真实来源发出变更（经链接保存时真实路径也发一条，由 ChangeHub 处理）。 */
export function saveText(target: WriteTarget, path: string, text: string, baseline: Baseline, origin: Origin): Promise<Outcome<SavedText>> {
    const {service, changes} = target;
    return tracked(target.scope, "files.write", async () => {
        const saved = await service.write(path, text, baseline, changes.temporaryPath);
        if (!saved.ok) return saved;
        changes.saved({path, realPath: saved.value.realPath, bytes: saved.value.bytes}, origin);
        return {ok: true as const, value: {baseline: saved.value.baseline, ...(saved.value.identity === undefined ? {} : {identity: saved.value.identity})}};
    });
}

/**
 * 普通目录里排他新建一个空文件或目录，不维护清单（挂载方案不做文件夹类型投影）。项目与 `user://` 的新建要维护内容文件夹的
 * 清单，走 `operations.ts`。
 */
export function createPlain(target: WriteTarget, path: string, kind: "file" | "directory", origin: Origin): Promise<Outcome<OperationDone>> {
    const {root, changes} = target;
    return tracked(target.scope, "files.create", async () => {
        const slot = await root.resolveSlot(path);
        if ("ok" in slot) return failure(slot);
        const made = kind === "file" ? await createFile(slot) : await createDirectory(slot);
        if (!made.ok) return failure(made);
        await changes.expect({present: [slot.path]});
        changes.emit([{type: "created", path: slot.path}], origin);
        return {ok: true as const, value: {}};
    });
}

function failure(failed: RootedFailure): Outcome<never> {
    return {ok: false, code: failed.code as Exclude<typeof failed.code, "unknown-scheme">, detail: {detail: failed.detail}};
}

/** 提供者的结果换成服务端文件服务的公共形状：详情摊平成字符串，保存冲突带上当前基线。 */
export function toResult<T>(outcome: Outcome<T>): ServerFilesResult<T> {
    if (outcome.ok) return outcome;
    const detail = outcome.detail;
    return {ok: false, code: outcome.code, detail: detail.detail, ...("current" in detail ? {current: detail.current} : {})};
}
