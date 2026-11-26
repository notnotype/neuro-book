/**
 * 稿纸页取 `meta`（当前条款版本、注册与各上游是否开放；`site.accounts` 的 `GET meta`）。每页进来时取一次，不挡页面：表单先画出来，
 * 社交图标的位置先占着（t10 计划 3.1“页面级的加载”）。要用条款版本提交时没取到的，`ensure` 再取一次，所以一次失败不把表单卡死。
 * 在 `setup` 里调用。
 */

import type {MetaResponse} from "@notnotype/nb-site-identity-contract/constants";
import {shallowRef} from "vue";
import type {ShallowRef} from "vue";

import type {Failure} from "../http/core";
import type {IdentityApi} from "../http/identity";

export type MetaState =
    | {readonly kind: "loading"}
    | {readonly kind: "ready"; readonly meta: MetaResponse}
    | {readonly kind: "failed"; readonly failure: Failure};

export interface PageMeta {
    readonly state: Readonly<ShallowRef<MetaState>>;
    /** 取到过就回那一份；正在取时等同一次；失败过就再取一次。 */
    ensure(): Promise<MetaState>;
    /** 不管取没取到都重取（条款版本可能刚换了）。 */
    refresh(): Promise<MetaState>;
}

export function usePageMeta(identity: Pick<IdentityApi, "meta">): PageMeta {
    const state = shallowRef<MetaState>({kind: "loading"});
    let inflight: Promise<MetaState> | undefined;

    function refresh(): Promise<MetaState> {
        state.value = {kind: "loading"};
        const pending: Promise<MetaState> = identity.meta().then((result) => {
            // 被更晚的一次取代了：以那一次为准，这一次的结果丢掉。
            if (inflight !== pending) return inflight ?? state.value;
            inflight = undefined;
            state.value = result.ok ? {kind: "ready", meta: result.value} : {kind: "failed", failure: result.failure};
            return state.value;
        });
        inflight = pending;
        return pending;
    }

    void refresh();

    return {
        state,
        ensure() {
            if (inflight !== undefined) return inflight;
            return state.value.kind === "ready" ? Promise.resolve(state.value) : refresh();
        },
        refresh,
    };
}
