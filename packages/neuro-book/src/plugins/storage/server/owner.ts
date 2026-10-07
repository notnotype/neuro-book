/**
 * 分区拥有者：本实例里的插件经本地路线直接读写，别的实例里的插件经远程服务到达这里（远程实现）。两条路一样
 * 按调用方身份取 owner 与客户端身份；远程带来的描述与资源 id 按同一套规则再核对一次，不信任对端。
 */

import type {RemoteImplementation} from "@notnotype/nb-runtime/remote";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";

import {descriptorProblem, resourceProblem} from "nbook/shared/storage";
import type {RecordDescriptor, RecordScope, StorageFailed} from "nbook/shared/storage";

import type {userStorageContract} from "../shared/contracts";
import type {PartitionRoute, RecordRequest, WriteOperation} from "../shared/facade";
import type {Partition, RecordAddress} from "./partition";

export interface PartitionOwner {
    /** 本实例里调用方的路线；调用方已由门面核对过插件身份、资源 id 与客户端身份。 */
    route(consumer: ConsumerIdentity): PartitionRoute;
    /** 别的实例里调用方的远程实现。 */
    remote(consumer: ConsumerIdentity): RemoteImplementation<typeof userStorageContract>;
    /**
     * 结束本地订阅（`onEnd("provider-stopped")`）并关闭库；之后的操作为 `unavailable`。幂等。某条订阅的 `onEnd`
     * 抛错不影响其余订阅结束与关库；全部完成后抛出第一个错误，由生命周期记为释放失败。
     */
    close(): void;
}

function addressOf(consumer: ConsumerIdentity, descriptor: RecordDescriptor, resource: string): RecordAddress {
    return {owner: consumer.plugin ?? "", key: descriptor.key, resource, client: descriptor.locality === "local" ? (consumer.client ?? "") : ""};
}

/** `onListenerError`：本地订阅的监听在推送第一次快照时抛错；之后的推送由分区库自己的回调报告。 */
export function createPartitionOwner(partition: Partition, scope: RecordScope, onListenerError: (error: unknown) => void): PartitionOwner {
    const localSubscriptions = new Set<{stop(): void; readonly onEnd: (reason: string) => void}>();
    let closed = false;

    const write = (consumer: ConsumerIdentity, request: RecordRequest, operation: WriteOperation) => partition.write(addressOf(consumer, request.descriptor, request.resource), request.descriptor, operation);

    /** 远程调用方的输入核对：身份、描述结构、分区是否对、资源 id、客户端身份。 */
    const admit = (consumer: ConsumerIdentity, input: {readonly record: unknown; readonly resource: string}): RecordRequest | StorageFailed => {
        if (consumer.plugin === null) return {ok: false, code: "denied", detail: "只有插件入口能使用 Storage"};
        const problem = descriptorProblem(input.record);
        if (problem !== null) return {ok: false, code: "definition-conflict", detail: `记录描述不合规则：${problem}`};
        const descriptor = input.record as RecordDescriptor;
        if (descriptor.scope !== scope) return {ok: false, code: "definition-conflict", detail: `记录 ${descriptor.key} 属于 ${descriptor.scope} 分区，这里是 ${scope} 分区`};
        const resourceIssue = resourceProblem(descriptor, input.resource === "" ? undefined : input.resource);
        if (resourceIssue !== null) return {ok: false, code: "invalid-resource", detail: resourceIssue};
        if (descriptor.locality === "local" && consumer.client === null) return {ok: false, code: "no-client", detail: `local 记录 ${descriptor.key} 需要客户端身份，调用方没有`};
        return {descriptor, resource: input.resource};
    };

    const storageFailed = (failure: StorageFailed) => ({ok: false as const, code: "storage-failed" as const, detail: {code: failure.code, detail: failure.detail}});

    return {
        route: (consumer) => ({
            open: (request) => Promise.resolve(partition.register(consumer.plugin ?? "", request.descriptor)),
            read: (request) => Promise.resolve(partition.read(addressOf(consumer, request.descriptor, request.resource), request.descriptor)),
            write: (request, operation) => Promise.resolve(write(consumer, request, operation)),
            subscribe: (request, listener, onEnd) => {
                if (closed) return Promise.resolve({ok: false, code: "unavailable", detail: "分区已关闭"});
                const watcher = partition.watch(addressOf(consumer, request.descriptor, request.resource), request.descriptor, listener);
                const entry = {stop: () => watcher.stop(), onEnd};
                localSubscriptions.add(entry);
                try {
                    listener(watcher.initial);
                } catch (error) {
                    onListenerError(error);
                }
                return Promise.resolve({
                    ok: true,
                    handle: {
                        release: () => {
                            if (localSubscriptions.delete(entry)) entry.stop();
                        },
                    },
                });
            },
        }),
        remote: (consumer) => ({
            methods: {
                open: (input) => {
                    const request = admit(consumer, input);
                    if ("ok" in request) return storageFailed(request);
                    const registered = partition.register(consumer.plugin ?? "", request.descriptor);
                    return registered.ok ? {ok: true, value: null} : storageFailed(registered);
                },
                read: (input) => {
                    const request = admit(consumer, input);
                    if ("ok" in request) return {ok: true, value: {status: "error", code: request.code, detail: request.detail}};
                    return {ok: true, value: partition.read(addressOf(consumer, request.descriptor, request.resource), request.descriptor)};
                },
                save: (input) => {
                    const request = admit(consumer, input);
                    if ("ok" in request) return storageFailed(request);
                    const result = write(consumer, request, {kind: "save", value: input.value, expect: input.expect});
                    return result.ok ? {ok: true, value: {revision: result.revision}} : storageFailed(result);
                },
                remove: (input) => {
                    const request = admit(consumer, input);
                    if ("ok" in request) return storageFailed(request);
                    const result = write(consumer, request, {kind: "remove", expect: input.expect});
                    return result.ok ? {ok: true, value: {revision: result.revision}} : storageFailed(result);
                },
                reset: (input) => {
                    const request = admit(consumer, input);
                    if ("ok" in request) return storageFailed(request);
                    const result = write(consumer, request, {kind: "reset", value: input.value, expect: input.expect});
                    return result.ok ? {ok: true, value: {revision: result.revision}} : storageFailed(result);
                },
            },
            events: {
                changes: {
                    subscribe: (filter, sink, {signal}) => {
                        const request = admit(consumer, filter);
                        if ("ok" in request) {
                            sink.next({status: "error", code: request.code, detail: request.detail});
                            return;
                        }
                        // 先取快照并登记，再推快照：同一段同步代码里完成，中间不会漏掉写入。
                        const watcher = partition.watch(addressOf(consumer, request.descriptor, request.resource), request.descriptor, (snapshot) => sink.next(snapshot));
                        sink.next(watcher.initial);
                        signal.addEventListener("abort", () => watcher.stop(), {once: true});
                    },
                },
            },
        }),
        close: () => {
            if (closed) return;
            closed = true;
            const failures: unknown[] = [];
            for (const subscription of [...localSubscriptions]) {
                localSubscriptions.delete(subscription);
                subscription.stop();
                try {
                    subscription.onEnd("provider-stopped");
                } catch (error) {
                    failures.push(error);
                }
            }
            partition.close();
            if (failures.length > 0) throw failures[0];
        },
    };
}
