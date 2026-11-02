/**
 * 浏览器侧的世界客户端：以调用方的身份经远程服务调用项目实例里的世界（docs/specs/canon/project.md 的方法表与输出 18）。
 *
 * - 请求编码后超过预算时不发出，直接得到 `too-large`。
 * - 业务失败（业务失败码 `canon`）换回 nb-canon 的失败对象；路由层的失败（断线、超时、项目不在）原样给出码与说明，
 *   写方法断线时是 `unknown-outcome`，调用方按请求 id 调 `outcome` 查结局（场景 7）。
 */

import type {DelegatedRemoteAccess} from "@notnotype/nb-runtime/plugins";
import type {RemoteSubscription} from "@notnotype/nb-runtime/remote";

import {CANON_BUDGET_BYTES, canonWorldContract, encodedBytes} from "../shared/contracts";
import type {CanonClient, CanonEvent, CanonFailure, CanonInput, CanonMethod, CanonOutputs, CanonResult} from "../shared/contracts";

type Raw = {readonly ok: true; readonly value: unknown} | {readonly ok: false; readonly code: string; readonly detail?: unknown};

function fromRemote<T>(result: Raw): CanonResult<T> {
    if (result.ok) return {ok: true, value: result.value as T};
    if (result.code === "canon") return {ok: false, failure: result.detail as CanonFailure};
    return {ok: false, failure: {code: result.code, ...(result.detail === undefined ? {} : {detail: result.detail})}};
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
            const subscriptions: RemoteSubscription[] = [];
            const release = () => {
                for (const subscription of subscriptions.splice(0)) subscription.release();
            };
            const results = [
                await events.changed.subscribe({}, (payload) => listener(payload as CanonEvent)),
                await events.exclusive.subscribe({}, (payload) => listener({kind: "exclusive", holder: payload.holder})),
                await events.reduced.subscribe({}, () => listener({kind: "reduced"})),
            ];
            for (const result of results) if (result.ok) subscriptions.push(result.value);
            const failed = results.find((result) => !result.ok);
            if (failed !== undefined && !failed.ok) {
                release();
                return fromRemote(failed);
            }
            return {ok: true, value: {release}};
        },
        hold: async (label, onEnded) => {
            const acquired = await call("acquireExclusive", {label});
            if (!acquired.ok) return acquired;
            const {token} = acquired.value;
            const lease = await remote().events.lease.subscribe({token}, (payload) => {
                if (payload.state === "ended") onEnded?.();
            });
            if (!lease.ok) {
                await call("releaseExclusive", {token});
                return fromRemote(lease);
            }
            return {
                ok: true,
                value: {
                    token,
                    release: async () => {
                        lease.value.release();
                        await call("releaseExclusive", {token});
                    },
                },
            };
        },
    };
}
