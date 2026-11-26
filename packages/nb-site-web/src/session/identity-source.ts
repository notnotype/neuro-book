/**
 * 当前账号的取数接到账号模块的两个接口（`site.accounts` 输出 7、8）。B2 建按接口分好的 `api.identity` 时，这两个函数挪过去，
 * `AccountSource` 不变。
 */

import {IDENTITY_API_PREFIX, IDENTITY_PATHS} from "@notnotype/nb-site-identity-contract";
import type {MeResponse, WhoamiResponse} from "@notnotype/nb-site-identity-contract";

import type {ApiCore} from "../api/core";
import type {AccountSource} from "./account";

export function identityAccountSource(api: ApiCore): AccountSource {
    // 两者自己处理 `unauthenticated`（见 `AccountSource` 的注释）；`GET me` 不受同意门槛限制（`site.accounts` 输出 10），不用声明。
    return {
        whoami: () => api.request<WhoamiResponse>({method: "GET", path: `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.whoami}`, handles: ["unauthenticated"]}),
        me: () => api.request<MeResponse>({method: "GET", path: `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.me}`, handles: ["unauthenticated"]}),
    };
}
