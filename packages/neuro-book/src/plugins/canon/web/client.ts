/**
 * 浏览器侧的世界客户端：以调用方的身份经远程服务调用项目实例里的世界（docs/specs/canon/project.md 的方法表、输出 10、18
 * 与“时序与寿命”）。
 *
 * - 请求编码后超过预算时不发出，直接得到 `too-large`。
 * - 业务失败（业务失败码 `canon`）换回 nb-canon 的失败对象；路由层的失败（断线、超时、项目不在）给出原码、说明与原因，
 *   写方法断线时是 `unknown-outcome`，调用方按请求 id 调 `outcome` 查结局（场景 7）。
 * - 订阅：重连后订阅已重建时推一个 `resync`（中间可能漏了事件）；订阅被提供方结束时推一个 `ended`。
 */

import type {DelegatedRemoteAccess} from "@notnotype/nb-runtime/plugins";
import type {RemoteResult, RemoteSubscription} from "@notnotype/nb-runtime/remote";

import {CANON_BUDGET_BYTES, canonWorldContract, encodedBytes} from "../shared/contracts";
import type {CanonClient, CanonEvent, CanonFailure, CanonInput, CanonMethod, CanonOutputs, CanonResult} from "../shared/contracts";

type Raw = {readonly ok: true; readonly value: unknown} | {readonly ok: false; readonly code: string; readonly detail?: unknown; readonly cause?: unknown};

function fromRemote<T>(result: Raw): CanonResult<T> {
    if (result.ok) return {ok: true, value: result.value as T};
    if (result.code === "canon") return {ok: false, failure: result.detail as CanonFailure};
    return {ok: false, failure: {code: result.code, ...(result.detail === undefined ? {} : {detail: result.detail}), ...(result.cause === undefined ? {} : {cause: result.cause})}};
}

/**
 * `access` 在每次调用时取：调用方身份要等按调用方的门面签发完才能用来委托（工厂里直接用得到 `denied`）。没有绑定项目时
 * 为 null。
 */
export function createCanonClient(access: (() => DelegatedRemoteAccess) | null): CanonClient {
    const remote = () => access!().use(canonWorldContract);
    const unbound: CanonResult<never> = {ok: false, failure: {code: "no-project", detail: "这个窗口没有绑定项目"}};

    const call = async <M extends CanonMethod>(method: M, input: CanonInput<M>): Promise<CanonResult<CanonOutputs[M]>> => {
        if (access === null) return unbound;
        if (encodedBytes(input) > CANON_BUDGET_BYTES) return {ok: false, failure: {code: "too-large"}};
        const invoke = remote()[method] as (input: CanonInput<M>) => Promise<Raw>;
        return fromRemote<CanonOutputs[M]>(await invoke(input));
    };

    return {
        call,
        publish: (request, token) => call("publish", {request, ...(token === undefined ? {} : {token})}),
        subscribe: async (listener) => {
            if (access === null) return unbound;
            const events = remote().events;
            // 三个事件各一条订阅，一起重建、一起结束：`resync` 与 `ended` 只从 `changed` 那条转出，免得推三遍。
            const results: Array<RemoteResult<RemoteSubscription>> = await Promise.all([
                events.changed.subscribe({}, (payload) => listener(payload as CanonEvent), {onResync: () => listener({kind: "resync"}), onEnd: (reason) => listener({kind: "ended", reason})}),
                events.exclusive.subscribe({}, (payload) => listener({kind: "exclusive", holder: payload.holder})),
                events.reduced.subscribe({}, () => listener({kind: "reduced"})),
            ]);
            const subscriptions = results.flatMap((result) => (result.ok ? [result.value] : []));
            const release = () => {
                for (const subscription of subscriptions.splice(0)) subscription.release();
            };
            const failed = results.find((result) => !result.ok);
            if (failed !== undefined) {
                release();
                return fromRemote(failed);
            }
            return {ok: true, value: {release}};
        },
        hold: async (label, onEnded) => {
            const acquired = await call("acquireExclusive", {label});
            if (!acquired.ok) return acquired;
            const {token, expires} = acquired.value;
            let ended = false;
            const end = (reason: string) => {
                if (ended) return;
                ended = true;
                onEnded?.(reason);
            };
            const lease = await remote().events.lease.subscribe({token}, (payload) => {
                if (payload.state === "ended") end("ended");
            }, {onEnd: (reason) => end(reason)});
            if (!lease.ok) {
                await call("releaseExclusive", {token});
                return fromRemote(lease);
            }
            return {
                ok: true,
                value: {
                    token,
                    expires,
                    renew: () => call("renewExclusive", {token}),
                    release: async () => {
                        // 自己释放不算“结束”的通知：先标记，退订与释放都不再调 onEnded。
                        ended = true;
                        lease.value.release();
                        return call("releaseExclusive", {token});
                    },
                },
            };
        },
    };
}
