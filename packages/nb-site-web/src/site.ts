/**
 * 把站点装起来：主题与明暗、接口层的核心、当前账号、路由，挂到页面上。`main.ts` 只用浏览器的真东西调它一次；
 * 组件测试用 happy-dom 的窗口调它，所以主题与守卫的运行期接线有测试守着（`site.dom.test.ts`）。
 *
 * 统一处理（计划 3.2“按码分支”）在这里接上路由：回调是同步的，跳转放后台；这次调用照常把失败交回页面。
 */

import {createApp} from "vue";
import type {App as VueApp} from "vue";
import type {Router, RouterHistory} from "vue-router";

import {createApiCore} from "./http/core";
import type {ApiCore} from "./http/core";
import {createIdentityApi} from "./http/identity";
import type {IdentityApi} from "./http/identity";
import App from "./App.vue";
import {SITE_CONTEXT_KEY} from "./context";
import type {SiteClock} from "./host/clock";
import {createSiteStorage} from "./host/storage";
import type {SiteStorage} from "./host/storage";
import {createSiteTheme} from "./host/theme";
import type {SiteTheme} from "./host/theme";
import {createSiteRouter, guardTarget} from "./router";
import {createCurrentAccount, knownAccount} from "./session/account";
import type {CurrentAccount} from "./session/account";
import {dispatch} from "./session/dispatch";
import {afterConsentRequired, afterUnauthenticated, takesConsentGate} from "./session/guard";

export interface StartSiteOptions {
    /** 挂载点。 */
    readonly target: Element;
    readonly window: Window;
    readonly fetch: (input: string, init: RequestInit) => Promise<Response>;
    readonly history: RouterHistory;
    /** 当前时刻与重复的计时（`host/clock.ts`）；产品里是浏览器的时钟，组件测试给手动推进的。 */
    readonly clock: SiteClock;
}

export interface Site {
    readonly app: VueApp;
    readonly router: Router;
    readonly account: CurrentAccount;
    readonly theme: SiteTheme;
    readonly api: ApiCore;
    readonly identity: IdentityApi;
    readonly storage: SiteStorage;
    readonly clock: SiteClock;
    /** 卸载应用、解除对系统明暗的监听。 */
    stop(): void;
}

/** 统一处理里的跳转放后台：失败（例如被后来的导航取代）由 vue-router 交给这里，记一条，不打断发请求的页面。 */
function navigateInBackground(navigation: Promise<unknown>, reason: string): void {
    navigation.catch((error: unknown) => console.warn(`${reason}之后的跳转没有完成`, error));
}

export function startSite(options: StartSiteOptions): Site {
    const {window: win} = options;
    const theme = createSiteTheme({root: win.document.documentElement, systemDark: win.matchMedia("(prefers-color-scheme: dark)")});

    // 核心的回调要用路由与当前账号，两者又要用核心：回调里引用的 `router`、`account` 在下面才建。回调只在请求得到回答之后被调用，
    // 而第一个请求由路由守卫发出，那时两者都已建好。
    const current = () => guardTarget(router.currentRoute.value);

    const api = createApiCore({
        fetch: options.fetch,
        now: () => options.clock.now(),
        handlers: {
            onUnauthenticated() {
                account.clear();
                const to = afterUnauthenticated(current());
                if (to !== undefined) navigateInBackground(router.replace(to), "会话失效");
                return true;
            },
            onConsentRequired() {
                const target = current();
                if (!takesConsentGate(target)) return false;
                // 先重取 `me`：缓存里“是否还缺同意”还是假的，不重取的话同意页的守卫会把人分派回来。
                const to = afterConsentRequired(target);
                navigateInBackground(account.refresh().then(() => (to === undefined ? undefined : router.replace(to))), "同意门槛");
                return true;
            },
            onForbidden() {
                // 角色可能刚被改（`site.admin` 输出 3）：丢掉缓存的身份，重取再分派。取不到时外壳会显示连不上。
                navigateInBackground(account.refresh().then((state) => {
                    const known = knownAccount(state);
                    return known === undefined ? undefined : router.replace(dispatch(known, undefined));
                }), "管理接口拒绝");
                return true;
            },
        },
    });

    const identity = createIdentityApi(api);
    const account = createCurrentAccount(identity);
    const router = createSiteRouter({history: options.history, account, origin: win.location.origin});
    const storage = createSiteStorage({storage: () => win.sessionStorage, now: () => options.clock.now()});

    const app = createApp(App);
    app.provide(SITE_CONTEXT_KEY, {account, theme, api, identity, storage, clock: options.clock});
    app.use(router);
    app.mount(options.target);

    return {
        app,
        router,
        account,
        theme,
        api,
        identity,
        storage,
        clock: options.clock,
        stop() {
            app.unmount();
            theme.dispose();
        },
    };
}
