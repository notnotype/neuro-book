/**
 * 层拥有者的两种出口：本实例里的配置经 `ownerLink` 直接读写它；别的实例经远程服务到达 `remoteLayer`。两条路都按
 * 内核填写的调用方身份写入，拥有者核对声明者。
 */

import type {RemoteImplementation} from "@notnotype/nb-runtime/remote";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";
import type {Static} from "typebox";

import type {LayerSnapshotSchema, userSettingsContract} from "../shared/contracts";
import type {LayerLink} from "../shared/instance";
import type {LayerSnapshot, LayerWriteResult} from "../shared/layers";
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
            set: async (input) => outcome(await owner.write(consumer, input.key, {kind: "set", value: input.value})),
            remove: async (input) => outcome(await owner.write(consumer, input.key, {kind: "delete"})),
        },
        events: {
            layer: {
                subscribe: (_filter, sink, {signal}) => {
                    const off = owner.subscribe((snapshot) => sink.next(wire(snapshot)));
                    sink.next(wire(owner.snapshot()));
                    signal.addEventListener("abort", off, {once: true});
                },
            },
        },
    };
}

function outcome(result: LayerWriteResult) {
    return result.ok ? {ok: true as const, value: {snapshot: wire(result.snapshot)}} : {ok: false as const, code: "settings-failed" as const, detail: {code: result.code, detail: result.detail}};
}

/** 链路上的形状：TypeBox 的数组类型是可变的，快照里的是只读的；内容相同，复制一层数组。 */
function wire(snapshot: LayerSnapshot): Static<typeof LayerSnapshotSchema> {
    return {...snapshot, problems: [...snapshot.problems]};
}
