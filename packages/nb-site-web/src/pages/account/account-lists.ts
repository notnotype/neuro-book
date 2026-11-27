/**
 * 账号页进页时要取的四份列表（t10 计划 3.12；`site.accounts` 输出 17、18、24，`site.oauth-provider` 输出 15）：已登录的设备、
 * 上游身份、邀请码、已授权的应用。资料不在这里，
 * 它是当前账号模块里的那一份（`session/account.ts`），改资料成功后由 `CurrentAccount.update` 换上。
 *
 * 四份一起取，都到了页面才画各节（计划 3.1“页面级的加载”）：只画出一部分时，后到的一节会把下面的节往下推。之后每一节在自己的
 * 操作完成后单独重取自己的那一份；重取失败时留着旧的列表，失败交给那一节的状态行。在 `setup` 里调用。
 */

import type {GrantItem, IdentityItem, InviteCodeItem, SessionItem} from "@notnotype/nb-site-identity-contract/constants";
import {shallowRef} from "vue";
import type {ShallowRef} from "vue";

import type {Failure, Result} from "../../http/core";
import type {IdentityApi} from "../../http/identity";

/** 一份列表：当前的项与重取。 */
export interface RemoteList<Item> {
    readonly items: Readonly<ShallowRef<readonly Item[]>>;
    /** 重取；成功时换上新的项。几次重取交错时以最后发起的那次为准，先发起的结果到达时丢掉。 */
    reload(): Promise<Result<readonly Item[]>>;
}

function remoteList<Item>(fetchItems: () => Promise<Result<{readonly items: readonly Item[]}>>): RemoteList<Item> {
    const items = shallowRef<readonly Item[]>([]);
    let generation = 0;
    return {
        items,
        async reload() {
            const mine = ++generation;
            const result = await fetchItems();
            if (!result.ok) return result;
            if (mine === generation) items.value = result.value.items;
            return {ok: true, value: result.value.items};
        },
    };
}

/**
 * - `loading`：第一次取，或失败后重试。
 * - `failed`：有一份没取到；`failure` 是第一份失败的。统一处理接管了的失败（会话没了）不到这里：人已经被带走了。
 */
export type AccountListsState = {readonly kind: "loading"} | {readonly kind: "ready"} | {readonly kind: "failed"; readonly failure: Failure};

export interface AccountLists {
    readonly state: Readonly<ShallowRef<AccountListsState>>;
    readonly sessions: RemoteList<SessionItem>;
    readonly identities: RemoteList<IdentityItem>;
    readonly invites: RemoteList<InviteCodeItem>;
    readonly grants: RemoteList<GrantItem>;
    /** 四份一起取；进页时调一次，失败后“重试”再调。 */
    load(): Promise<void>;
}

export function useAccountLists(identity: Pick<IdentityApi, "sessions" | "identities" | "inviteCodes" | "grants">): AccountLists {
    const state = shallowRef<AccountListsState>({kind: "loading"});
    const sessions = remoteList(() => identity.sessions());
    const identities = remoteList(() => identity.identities());
    const invites = remoteList(() => identity.inviteCodes());
    const grants = remoteList(() => identity.grants());
    let generation = 0;

    return {
        state,
        sessions,
        identities,
        invites,
        grants,
        async load() {
            const mine = ++generation;
            state.value = {kind: "loading"};
            const results = await Promise.all([sessions.reload(), identities.reload(), invites.reload(), grants.reload()]);
            if (mine !== generation) return;
            const failed = results.find((result) => !result.ok);
            if (failed === undefined || failed.ok) {
                state.value = {kind: "ready"};
                return;
            }
            // 统一处理已经把人带去登录页或同意页：留在“正在载入”，不在离开前闪一下失败。
            if (failed.failure.kind === "code" && failed.failure.handled === true) return;
            state.value = {kind: "failed", failure: failed.failure};
        },
    };
}
