/**
 * 远程路线：以调用方的身份（`context.remote.on(调用方)`）经远程服务把操作转给分区的拥有者。浏览器入口用它到达
 * user 与 project 分区，项目入口用它到达 user 分区。拥有者看到的调用方是原插件、`via` 为本入口。
 */

import type {DelegatedRemoteAccess} from "@notnotype/nb-runtime/plugins";
import type {RemoteClient, RemoteFailure} from "@notnotype/nb-runtime/remote";

import type {RecordSnapshot, StorageFailed, StorageFailure} from "nbook/shared/storage";

import {projectStorageContract, userStorageContract} from "./contracts";
import type {StorageContract} from "./contracts";
import type {PartitionRoute, RecordRequest} from "./facade";

/** 两份合同的方法与事件相同，客户端类型也相同。 */
type StorageClient = RemoteClient<typeof userStorageContract>;

export function remoteRoute(access: DelegatedRemoteAccess, contract: StorageContract): PartitionRoute {
    const client = (): StorageClient => (contract === userStorageContract ? access.use(userStorageContract) : access.use(projectStorageContract));
    const address = (request: RecordRequest) => ({record: request.descriptor, resource: request.resource});
    return {
        open: async (request) => {
            const result = await client().open(address(request));
            return result.ok ? {ok: true} : fromRemote(result);
        },
        read: async (request) => {
            const result = await client().read(address(request));
            if (result.ok) return result.value as RecordSnapshot<unknown>;
            const failure = fromRemote(result);
            return {status: "error", code: failure.code, detail: failure.detail};
        },
        write: async (request, operation) => {
            const result =
                operation.kind === "remove"
                    ? await client().remove({...address(request), expect: operation.expect})
                    : await client()[operation.kind]({...address(request), value: operation.value, expect: operation.expect});
            return result.ok ? {ok: true, revision: result.value.revision} : fromRemote(result);
        },
        subscribe: async (request, listener, onEnd) => {
            // 重连后内核重建订阅，拥有者先推一次当时的快照，所以不用另外在 onResync 里重读。
            const result = await client().events.changes.subscribe(address(request), (snapshot) => listener(snapshot as RecordSnapshot<unknown>), {onEnd});
            return result.ok ? {ok: true, handle: result.value} : fromRemote(result);
        },
    };
}

/**
 * 拥有者一侧的失败经业务失败码 `storage-failed` 带回原失败码；路由层的失败按含义折算：调用方身份核对不过为
 * `denied`，写请求帧发出后被中断为 `unknown-outcome`，输入不合合同（多半是值无法编码）为 `invalid-value`，拥有者
 * 抛错为 `io-error`，其余（目标不在、目标实例没有 Storage 的提供方、超时、服务端不可达、版本不符）为 `unavailable`。
 */
function fromRemote(failure: RemoteFailure<string>): StorageFailed {
    if (failure.code === "storage-failed") {
        const detail = failure.detail as {readonly code: StorageFailure; readonly detail: string};
        return {ok: false, code: detail.code, detail: detail.detail};
    }
    const reason = typeof failure.detail === "string" ? `${failure.code}：${failure.detail}` : failure.cause === undefined ? failure.code : `${failure.code}（${failure.cause}）`;
    switch (failure.code) {
        case "denied":
            return {ok: false, code: "denied", detail: reason};
        case "unknown-outcome":
            return {ok: false, code: "unknown-outcome", detail: reason};
        case "invalid-input":
            return {ok: false, code: "invalid-value", detail: reason};
        case "provider-error":
            return {ok: false, code: "io-error", detail: reason};
        default:
            return {ok: false, code: "unavailable", detail: reason};
    }
}
