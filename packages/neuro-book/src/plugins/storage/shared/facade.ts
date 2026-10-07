/**
 * 交给每个调用方插件的 Storage 服务对象（docs/specs/storage/persistence.md 输出第 1、8 条）。三端共用：分区在
 * 本实例时走本地路线（直接读写分区库），不在时走远程路线（以调用方的身份经远程服务转给分区的拥有者）。
 *
 * owner 与客户端身份只取内核填写的调用方身份，接口上没有这两个参数。
 */

import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";

import {resourceProblem} from "nbook/shared/storage";
import type {RecordDefinition, RecordDescriptor, RecordHandle, RecordSnapshot, StorageFailed, StorageService, SubscribeResult, WriteResult} from "nbook/shared/storage";

export interface RecordRequest {
    readonly descriptor: RecordDescriptor;
    /** 不按资源寻址的记录为空串。 */
    readonly resource: string;
}

export type WriteOperation =
    | {readonly kind: "save" | "reset"; readonly value: unknown; readonly expect: string | null}
    | {readonly kind: "remove"; readonly expect: string | null};

/** 到达某个分区的一条路线；owner 与客户端身份在创建路线时已经定下。 */
export interface PartitionRoute {
    open(request: RecordRequest): Promise<{readonly ok: true} | StorageFailed>;
    read(request: RecordRequest): Promise<RecordSnapshot<unknown>>;
    write(request: RecordRequest, operation: WriteOperation): Promise<WriteResult>;
    subscribe(request: RecordRequest, listener: (snapshot: RecordSnapshot<unknown>) => void, onEnd: (reason: string) => void): Promise<SubscribeResult>;
}

/**
 * 按 scope 取路线；分区在这个位置不可用时给出失败（例如没有绑定项目为 `no-project`）。每次打开时才取：
 * 浏览器的远程路线要以内核签发的调用方身份代理，而门面工厂运行时这个身份还没有签发完。
 */
export interface StorageRoutes {
    readonly user: () => PartitionRoute | StorageFailed;
    readonly project: () => PartitionRoute | StorageFailed;
}

export interface StorageFacade {
    readonly service: StorageService;
    /**
     * 门面释放：结束它建立的订阅（`onEnd("released")`），之后的操作为 `unavailable`。幂等。某条订阅的 `onEnd` 抛错
     * 不影响其余订阅结束；全部结束后抛出第一个错误，由生命周期记为释放失败。
     */
    release(): void;
}

function failed(code: StorageFailed["code"], detail: string): StorageFailed {
    return {ok: false, code, detail};
}

export function createStorageFacade(consumer: ConsumerIdentity, routes: StorageRoutes): StorageFacade {
    let released = false;
    /** 活订阅：它的结束函数 → 底层订阅句柄。 */
    const subscriptions = new Map<(reason: string) => void, {release(): void}>();
    const gone = (): StorageFailed => failed("unavailable", "Storage 服务对象已释放");

    const open = async <T>(record: RecordDefinition<T>, resource?: string): Promise<{readonly ok: true; readonly handle: RecordHandle<T>} | StorageFailed> => {
        if (released) return gone();
        if (consumer.plugin === null) return failed("denied", "只有插件入口能使用 Storage");
        const problem = resourceProblem(record.descriptor, resource);
        if (problem !== null) return failed("invalid-resource", problem);
        if (record.locality === "local" && consumer.client === null) return failed("no-client", `local 记录 ${record.key} 需要客户端身份，这个位置没有`);
        const route = routes[record.scope]();
        if ("ok" in route) return route;
        const request: RecordRequest = {descriptor: record.descriptor, resource: resource ?? ""};
        const opened = await route.open(request);
        if (!opened.ok) return opened;
        return {ok: true, handle: handleFor<T>(route, request)};
    };

    const handleFor = <T>(route: PartitionRoute, request: RecordRequest): RecordHandle<T> => ({
        read: async () => (released ? {status: "error", ...withoutOk(gone())} : ((await route.read(request)) as RecordSnapshot<T>)),
        save: (value, {expect}) => (released ? Promise.resolve(gone()) : route.write(request, {kind: "save", value, expect})),
        remove: ({expect}) => (released ? Promise.resolve(gone()) : route.write(request, {kind: "remove", expect})),
        reset: (value, {expect}) => (released ? Promise.resolve(gone()) : route.write(request, {kind: "reset", value, expect})),
        subscribe: async (listener, options = {}) => {
            if (released) return gone();
            // 每条订阅至多结束一次。结束可能早于建立返回（例如首快照的监听里停了提供方），这时不再登记为活订阅。
            let ended = false;
            const end = (reason: string): void => {
                if (ended) return;
                ended = true;
                subscriptions.delete(end);
                options.onEnd?.(reason);
            };
            const result = await route.subscribe(request, listener as (snapshot: RecordSnapshot<unknown>) => void, end);
            if (!result.ok) return result;
            const handle = result.handle;
            if (released) {
                handle.release();
                return gone();
            }
            if (!ended) subscriptions.set(end, handle);
            return {
                ok: true,
                handle: {
                    // 调用方自己释放不算结束，不调用 onEnd。
                    release: () => {
                        ended = true;
                        if (subscriptions.delete(end)) handle.release();
                    },
                },
            };
        },
    });

    return {
        service: {open},
        release: () => {
            if (released) return;
            released = true;
            const failures: unknown[] = [];
            for (const [end, handle] of [...subscriptions]) {
                for (const step of [() => handle.release(), () => end("released")]) {
                    try {
                        step();
                    } catch (error) {
                        failures.push(error);
                    }
                }
            }
            if (failures.length > 0) throw failures[0];
        },
    };
}

function withoutOk(failure: StorageFailed): {readonly code: StorageFailed["code"]; readonly detail: string} {
    return {code: failure.code, detail: failure.detail};
}
