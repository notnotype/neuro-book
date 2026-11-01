/**
 * 层拥有者的两种出口：本实例里的配置经 `ownerLink` 直接读写它；别的实例经远程服务到达 `remoteLayer`。两条路都按
 * 内核填写的调用方身份写入，拥有者核对声明者。用户编辑（`edit`、`unset`）与整份读写（`readText`、`writeText`）只在
 * 远程服务上：设置窗口在浏览器里。
 */

import type {RemoteImplementation} from "@notnotype/nb-runtime/remote";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";
import type {Static} from "typebox";

import type {SettingsFailure} from "nbook/shared/settings";

import type {LayerSnapshotSchema, userSettingsContract} from "../shared/contracts";
import type {LayerLink} from "../shared/instance";
import type {LayerSnapshot, LayerTextPosition, LayerWriteResult} from "../shared/layers";
import type {LayerOwner} from "./layer-owner";

export function ownerLink(owner: LayerOwner): LayerLink {
    return {
        subscribe: (onSnapshot) => {
            // 先登记再推当前快照：两步在同一段同步代码里，中间不会漏掉发布。
            const off = owner.subscribe(onSnapshot);
            onSnapshot(owner.snapshot());
            return Promise.resolve({ok: true, release: off});
        },
        write: (consumer, key, edit) => owner.write(consumer, key, edit),
    };
}

/** 两份合同的方法与事件相同，实现的类型也相同。 */
export function remoteLayer(owner: LayerOwner, consumer: ConsumerIdentity): RemoteImplementation<typeof userSettingsContract> {
    return {
        methods: {
            set: async (input) => outcome(await owner.write(consumer, input.key, {kind: "set", value: input.value, ...(input.expect === undefined ? {} : {expect: input.expect})})),
            remove: async (input) => outcome(await owner.write(consumer, input.key, {kind: "delete", ...(input.expect === undefined ? {} : {expect: input.expect})})),
            edit: async (input) => outcome(await owner.userEdit(consumer, input.key, {kind: "set", value: input.value})),
            unset: async (input) => outcome(await owner.userEdit(consumer, input.key, {kind: "delete"})),
            readText: async () => {
                const read = await owner.readText(consumer);
                return read.ok ? {ok: true as const, value: {text: read.text, revision: read.revision, exists: read.exists}} : failed(read);
            },
            writeText: async (input) => {
                const written = await owner.writeText(consumer, input.text, input.revision);
                return written.ok ? {ok: true as const, value: {revision: written.revision, snapshot: wire(written.snapshot)}} : failed(written);
            },
        },
        events: {
            layer: {
                subscribe: (_filter, sink, {signal}) => {
                    const off = owner.subscribe((snapshot) => sink.next(wire(snapshot)));
                    sink.next(wire(owner.snapshot()));
                    signal.addEventListener("abort", off, {once: true});
                },
            },
            text: {
                subscribe: (_filter, sink, {signal}) => {
                    const off = owner.subscribeText((revision) => sink.next({revision}));
                    const revision = owner.textRevision();
                    if (revision !== null) sink.next({revision});
                    signal.addEventListener("abort", off, {once: true});
                },
            },
        },
    };
}

function outcome(result: LayerWriteResult) {
    return result.ok ? {ok: true as const, value: {snapshot: wire(result.snapshot)}} : failed(result);
}

function failed(result: {readonly code: SettingsFailure; readonly detail: string; readonly position?: LayerTextPosition}) {
    return {ok: false as const, code: "settings-failed" as const, detail: {code: result.code, detail: result.detail, ...(result.position === undefined ? {} : {position: result.position})}};
}

/** 链路上的形状：TypeBox 的数组类型是可变的，快照里的是只读的；内容相同，复制一层数组。 */
function wire(snapshot: LayerSnapshot): Static<typeof LayerSnapshotSchema> {
    return {...snapshot, problems: [...snapshot.problems]};
}
