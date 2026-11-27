/**
 * 登出之后的清理（t10 计划 3.9）。同意页（B3）与账号页（B4）的“退出登录”用它。
 */

import type {EmptyResponse} from "@notnotype/nb-site-identity-contract/constants";

import type {Result} from "../http/core";
import type {IdentityApi} from "../http/identity";
import type {SiteStorage} from "../host/storage";
import type {CurrentAccount} from "./account";

/**
 * 登出：结束当前会话，清掉当前账号与社交注册的草稿（计划 3.9“什么时候读与清”）。会话本来就没了（`unauthenticated`）也算登出成功。
 * 别的失败时什么都不清，回失败给页面显示：会话可能还在，不能让页面显示成已登出。去哪一页由调用方决定。
 */
export async function signOut(identity: IdentityApi, account: CurrentAccount, storage: SiteStorage): Promise<Result<EmptyResponse>> {
    const result = await identity.logout();
    const ended = result.ok || (result.failure.kind === "code" && result.failure.code === "unauthenticated");
    if (!ended) return result;
    account.clear();
    storage.clearSocialRegisterDraft();
    return {ok: true, value: {}};
}
