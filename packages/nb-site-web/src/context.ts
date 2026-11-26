/**
 * 应用根交给组件的东西（`site.ts` 里 provide）。单独一个模块：`site.ts` 导入 `App.vue`，组件再从 `site.ts` 取键会成环。
 */

import {inject} from "vue";
import type {InjectionKey} from "vue";

import type {ApiCore} from "./http/core";
import type {IdentityApi} from "./http/identity";
import type {SiteClock} from "./host/clock";
import type {SiteStorage} from "./host/storage";
import type {SiteTheme} from "./host/theme";
import type {CurrentAccount} from "./session/account";

export interface SiteContext {
    readonly account: CurrentAccount;
    readonly theme: SiteTheme;
    readonly api: ApiCore;
    /** 账号模块的接口（建在 `api` 上）。 */
    readonly identity: IdentityApi;
    readonly storage: SiteStorage;
    readonly clock: SiteClock;
}

export const SITE_CONTEXT_KEY: InjectionKey<SiteContext> = Symbol("nb-site.context");

/** 在 `setup` 里调用。不在应用根下面挂的组件（组件测试要自己 provide）拿不到时抛出，免得静默地用上一份空的。 */
export function useSite(): SiteContext {
    const context = inject(SITE_CONTEXT_KEY, null);
    if (context === null) throw new Error("useSite 要在 startSite 挂载的应用里调用，或由测试 provide SITE_CONTEXT_KEY");
    return context;
}
