/**
 * 到别的实例里的层拥有者的路（浏览器的两层、项目实例的用户层）。订阅以 `nbook.settings` 自己的身份建立：读不需要
 * 区分调用方，一个实例一条订阅。写入以原调用方的身份（`context.remote.on(调用方)`）经代理发出，拥有者看到的调用方
 * 是原插件、`via` 为 `nbook.settings`，据此核对声明者。
 */

import type {ActivationContext} from "@notnotype/nb-runtime/plugins";
import type {RemoteFailure} from "@notnotype/nb-runtime/remote";

import {freezeJson} from "nbook/shared/settings";
import type {SettingsFailure} from "nbook/shared/settings";

import {projectSettingsContract, userSettingsContract} from "./contracts";
import type {SettingsContract} from "./contracts";
import type {LayerLink} from "./instance";
import type {LayerSnapshot, LayerWriteResult} from "./layers";

/** 订阅以这些原因结束时不再重订：窗口整体失效，或调用方自己释放。 */
const TERMINAL_ENDS: ReadonlySet<string> = new Set(["server-restarted", "project-gone", "released"]);
/** 订阅建立失败时，这些失败码说明连接或提供方暂时不行，连接恢复后值得再订一次。 */
const RETRYABLE: ReadonlySet<string> = new Set(["unavailable", "timeout", "target-gone", "cancelled"]);

export function remoteLayerLink(remote: ActivationContext["remote"], contract: SettingsContract): LayerLink {
    // 两份合同的方法与事件相同；按合同对象分开取，客户端类型才精确。
    const own = () => (contract === userSettingsContract ? remote.use(userSettingsContract) : remote.use(projectSettingsContract));
    return {
        subscribe: async (onSnapshot, onEnd) => {
            const result = await own().events.layer.subscribe({}, (snapshot) => onSnapshot(frozen(snapshot as LayerSnapshot)), {onEnd: (reason) => onEnd(reason, !TERMINAL_ENDS.has(reason))});
            if (result.ok) return {ok: true, release: () => result.value.release()};
            return {ok: false, code: result.code, detail: describe(result), retry: RETRYABLE.has(result.code)};
        },
        write: async (consumer, key, edit) => {
            const delegated = remote.on(consumer);
            const client = contract === userSettingsContract ? delegated.use(userSettingsContract) : delegated.use(projectSettingsContract);
            const result = edit.kind === "set" ? await client.set({key, value: edit.value}) : await client.remove({key});
            return result.ok ? {ok: true, snapshot: frozen(result.value.snapshot as LayerSnapshot)} : fromRemote(result);
        },
    };
}

/** 链路解码出来的快照是可变的普通对象；与本地拥有者的一样逐层冻结，读取方改不动。 */
function frozen(snapshot: LayerSnapshot): LayerSnapshot {
    return Object.freeze({...snapshot, revision: Object.freeze({...snapshot.revision}), values: freezeJson(snapshot.values), problems: Object.freeze(snapshot.problems.map((problem) => Object.freeze({...problem})))});
}

/**
 * 拥有者一侧的失败经业务失败码 `settings-failed` 带回原失败码；路由层的失败按含义折算：调用方身份核对不过为
 * `denied`，写请求帧发出后被中断为 `unknown-outcome`，输入不合合同（多半是值无法编码）为 `invalid-value`，拥有者
 * 抛错为 `write-failed`，其余（目标不在、没有提供方、超时、服务端不可达、版本不符）为 `unavailable`。
 */
function fromRemote(failure: RemoteFailure<string>): LayerWriteResult {
    if (failure.code === "settings-failed") {
        const detail = failure.detail as {readonly code: SettingsFailure; readonly detail: string};
        return {ok: false, code: detail.code, detail: detail.detail};
    }
    const reason = describe(failure);
    switch (failure.code) {
        case "denied":
            return {ok: false, code: "denied", detail: reason};
        case "unknown-outcome":
            return {ok: false, code: "unknown-outcome", detail: reason};
        case "invalid-input":
            return {ok: false, code: "invalid-value", detail: reason};
        case "provider-error":
            return {ok: false, code: "write-failed", detail: reason};
        default:
            return {ok: false, code: "unavailable", detail: reason};
    }
}

function describe(failure: RemoteFailure<string>): string {
    if (typeof failure.detail === "string") return `${failure.code}：${failure.detail}`;
    return failure.cause === undefined ? failure.code : `${failure.code}（${failure.cause}）`;
}
