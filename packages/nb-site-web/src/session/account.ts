/**
 * 当前账号（t10 计划 3.1“守卫”与第 2 节“共享状态”）：全站跨页的状态只有这一份。第一次导航时取 `whoami`，已登录时再取 `me`
 * （要它的“是否还缺同意”，`whoami` 只给角色；`site.accounts` 输出 7、8），之后的导航不再取；登录、注册、同意、登出、
 * 任何请求得到 `unauthenticated` 时由调用方更新或清空。
 *
 * 对一个只有两个函数的小接口编程（`AccountSource`），不认识具体的请求：测试直接给真实的接口层核心加注入的 `fetch`。
 */

import {readonly, shallowRef} from "vue";
import type {Ref} from "vue";

import type {MeResponse, WhoamiResponse} from "@notnotype/nb-site-identity-contract";

import type {Failure, Result} from "../api/core";
import type {KnownAccount} from "./dispatch";

/**
 * 取身份的两个接口。两者都要自己处理 `unauthenticated`（`ApiRequest.handles`）：它们在路由守卫里被调用，
 * 统一处理再发起一次跳转会与正在进行的导航打架；这里把它当作“匿名”收下。
 */
export interface AccountSource {
    whoami(): Promise<Result<WhoamiResponse>>;
    me(): Promise<Result<MeResponse>>;
}

/**
 * - `unknown`：还没取过。
 * - `unavailable`：取不到（账号库不可读的 503 `unavailable`、连不上、回答看不懂）。不当作匿名：外壳整页显示“暂时连不上账号服务”与重试。
 */
export type AccountState =
    | {readonly kind: "unknown"}
    | {readonly kind: "anonymous"}
    | {readonly kind: "signed-in"; readonly me: MeResponse}
    | {readonly kind: "unavailable"; readonly failure: Failure};

export interface CurrentAccount {
    readonly state: Readonly<Ref<AccountState>>;
    /** 还没取过就取一次；正在取时等同一次。其余时候直接回现有的状态。 */
    ensure(): Promise<AccountState>;
    /** 不管有没有取过都重取一次（重试、角色可能刚被改、登录与同意之后）。 */
    refresh(): Promise<AccountState>;
    /** 登出或会话没了：当作匿名。正在进行的取数结果到达时丢掉。 */
    clear(): void;
}

/** 分派与守卫用的那部分；`unknown`、`unavailable` 回 `undefined`。 */
export function knownAccount(state: AccountState): KnownAccount | undefined {
    if (state.kind === "anonymous") return {kind: "anonymous"};
    if (state.kind === "signed-in") return {kind: "signed-in", role: state.me.role, consentRequired: state.me.consentRequired};
    return undefined;
}

async function load(source: AccountSource): Promise<AccountState> {
    const whoami = await source.whoami();
    if (!whoami.ok) return {kind: "unavailable", failure: whoami.failure};
    if (whoami.value.state === "anonymous") return {kind: "anonymous"};
    const me = await source.me();
    if (me.ok) return {kind: "signed-in", me: me.value};
    // `whoami` 之后会话恰好没了（被结束、到期）：就是匿名。
    if (me.failure.kind === "code" && me.failure.code === "unauthenticated") return {kind: "anonymous"};
    return {kind: "unavailable", failure: me.failure};
}

export function createCurrentAccount(source: AccountSource): CurrentAccount {
    const state = shallowRef<AccountState>({kind: "unknown"});
    // 每次取数与清空都换一代：后发起的取数或清空之后，先发起的那次结果到达时不再写进状态。
    let generation = 0;
    let inflight: Promise<AccountState> | undefined;

    function refresh(): Promise<AccountState> {
        const mine = ++generation;
        const pending = load(source).then(
            (next) => {
                if (mine === generation) {
                    state.value = next;
                    inflight = undefined;
                }
                return state.value;
            },
            (error: unknown) => {
                // 接口层不 reject（失败都在结果里）；真 reject 了是程序错误，原样抛给调用方，只是别让下一次 `ensure` 一直等这一次。
                if (mine === generation) inflight = undefined;
                throw error;
            },
        );
        inflight = pending;
        return pending;
    }

    return {
        state: readonly(state) as Readonly<Ref<AccountState>>,
        ensure() {
            if (inflight !== undefined) return inflight;
            if (state.value.kind !== "unknown") return Promise.resolve(state.value);
            return refresh();
        },
        refresh,
        clear() {
            generation += 1;
            inflight = undefined;
            state.value = {kind: "anonymous"};
        },
    };
}
