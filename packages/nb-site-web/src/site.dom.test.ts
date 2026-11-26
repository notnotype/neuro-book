/**
 * 装起来的站点（`site.ts`）：主题与明暗的运行期接线、守卫走真实的路由、统一处理之后的跳转、取不到身份时的整页提示与重试、
 * “没有这一页”。用 happy-dom 的窗口与 vue-router 的内存历史；账号服务的回答由注入的 `fetch` 按路径给出，测试中途可以改。
 */

import {IDENTITY_API_PREFIX, IDENTITY_PATHS} from "@notnotype/nb-site-identity-contract/constants";
import type {MeResponse, WhoamiResponse} from "@notnotype/nb-site-identity-contract/constants";
import nbookTheme from "@notnotype/nb-ui/themes/nbook";
import {afterEach, describe, expect, it, vi} from "vitest";
import {createMemoryHistory} from "vue-router";

import zhCN from "./locales/zh-CN.json";
import {startSite} from "./site";
import {manualClock} from "./testing/manual-clock";
import type {Site} from "./site";

const WHOAMI = `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.whoami}`;
const ME = `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.me}`;
const ADMIN_USERS = `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.adminUsers}`;

type Role = MeResponse["role"];

function me(role: Role, consentRequired = false): MeResponse {
    return {
        id: 7,
        username: "alice",
        displayName: "Alice",
        avatarUrl: null,
        website: null,
        bio: null,
        role,
        createdAt: "2026-11-01T00:00:00.000Z",
        email: null,
        emailPending: true,
        hasPassword: true,
        consentRequired,
    };
}

/** 账号服务现在的样子；测试中途改它，下一次请求就按新的回答。 */
interface Server {
    whoami: () => Response;
    me: () => Response;
    other: () => Response;
}

const anonymousServer = (): Server => ({
    whoami: () => Response.json({state: "anonymous"} satisfies WhoamiResponse),
    me: () => Response.json({error: {code: "unauthenticated"}}, {status: 401}),
    other: () => Response.json({}),
});

function signedInServer(role: Role, consentRequired = false): Server {
    return {
        whoami: () => Response.json({state: "authenticated", user: {id: 7, username: "alice", role}} satisfies WhoamiResponse),
        me: () => Response.json(me(role, consentRequired)),
        other: () => Response.json({}),
    };
}

interface Started {
    readonly site: Site;
    readonly target: HTMLElement;
    readonly server: Server;
    readonly requested: string[];
}

const started: Site[] = [];

afterEach(() => {
    for (const site of started.splice(0)) site.stop();
    device().prefersColorScheme = "light";
    document.body.replaceChildren();
});

function start(path: string, server: Server): Started {
    const target = document.createElement("div");
    document.body.append(target);
    const history = createMemoryHistory();
    history.replace(path);
    const requested: string[] = [];
    const site = startSite({
        target,
        window,
        history,
        clock: manualClock(Date.parse("2026-11-26T10:00:00Z")),
        fetch: async (input) => {
            requested.push(input);
            if (input === WHOAMI) return server.whoami();
            if (input === ME) return server.me();
            return server.other();
        },
    });
    started.push(site);
    return {site, target, server, requested};
}

/**
 * 等到路由停在 `fullPath`、页面画出 `page`。vue-router 对查询串另有一套编码（`next=%2Faccount` 记成 `next=/account`），
 * 所以比的是解码后的路径与查询参数。
 */
async function settledAt({site, target}: Started, fullPath: string, page: string): Promise<void> {
    const url = new URL(fullPath, "http://site.invalid");
    const expected = {path: url.pathname, query: Object.fromEntries(url.searchParams)};
    await vi.waitFor(() => {
        const route = site.router.currentRoute.value;
        expect({path: route.path, query: route.query}).toEqual(expected);
        expect(target.querySelector(`[data-site-page="${page}"]`)).not.toBeNull();
    });
}

interface Device {
    prefersColorScheme: string;
}

function device(): Device {
    return (window as unknown as {happyDOM: {settings: {device: Device}}}).happyDOM.settings.device;
}

/** happy-dom 在窗口尺寸变化时重算媒体查询并发 `change`；改了系统明暗之后发一次 resize 让它重算。 */
function setSystemScheme(scheme: "light" | "dark"): void {
    device().prefersColorScheme = scheme;
    window.dispatchEvent(new Event("resize"));
}

const root = (): HTMLElement => document.documentElement;
const colorwayBg = (id: "nbook-light" | "nbook-dark"): string => {
    const value = nbookTheme.colorways?.[id]?.["--bg-main"];
    if (typeof value !== "string") throw new Error(`nbook 主题的 ${id} 没有 --bg-main`);
    return value;
};

describe("主题与明暗的接线", () => {
    it("根元素写上 nbook 主题、跟随系统的明暗与同一明暗的配色，语言是中文", async () => {
        const started = start("/login", anonymousServer());
        await settledAt(started, "/login", "login");
        expect(root().dataset.nbTheme).toBe("nbook");
        expect(root().dataset.nbAppearance).toBe("light");
        expect(root().classList.contains("nb-ui-colorway")).toBe(true);
        expect(root().style.getPropertyValue("--bg-main")).toBe(colorwayBg("nbook-light"));
        expect(root().lang).toBe("zh-CN");
        expect(started.site.theme.resolved.value).toBe("light");
    });

    it("系统换成暗色时跟着换；手动选了明暗后不再看系统，选回跟随系统时又按系统", async () => {
        const {site} = start("/login", anonymousServer());
        setSystemScheme("dark");
        expect(root().dataset.nbAppearance).toBe("dark");
        expect(root().style.getPropertyValue("--bg-main")).toBe(colorwayBg("nbook-dark"));
        expect(site.theme.resolved.value).toBe("dark");

        site.theme.setAppearance("light");
        expect(root().dataset.nbAppearance).toBe("light");
        setSystemScheme("light");
        setSystemScheme("dark");
        expect(root().dataset.nbAppearance).toBe("light");

        site.theme.setAppearance("system");
        expect(root().dataset.nbAppearance).toBe("dark");
        expect(root().style.getPropertyValue("--bg-main")).toBe(colorwayBg("nbook-dark"));
    });

    it("停掉站点后不再跟着系统换", () => {
        const {site} = start("/login", anonymousServer());
        site.stop();
        started.splice(started.indexOf(site), 1);
        setSystemScheme("dark");
        expect(root().dataset.nbAppearance).toBe("light");
    });
});

describe("守卫走真实的路由", () => {
    it("访客进要登录的页：带着原地址去登录，标签页标题跟着页面", async () => {
        const started = start("/account", anonymousServer());
        await settledAt(started, "/login?next=%2Faccount", "login");
        expect(started.site.router.currentRoute.value.query).toEqual({next: "/account"});
        expect(document.title).toBe(`${zhCN.login.title} · NeuroBook`);
    });

    it("已登录的管理员进登录页去看板，普通用户进管理面板去账号页", async () => {
        await settledAt(start("/login", signedInServer("admin")), "/admin", "admin-dashboard");
        await settledAt(start("/admin/users", signedInServer("user")), "/account", "account");
    });

    it("登录页带着站内的 next 时登录的人去 next；站外的 next 当作没带", async () => {
        await settledAt(start("/login?next=%2Fadmin%2Faudit", signedInServer("admin")), "/admin/audit", "admin-audit");
        await settledAt(start("/login?next=%2F%2Fevil.example%2F", signedInServer("user")), "/account", "account");
    });

    it("缺同意的人进要登录的页：带着原地址去同意页", async () => {
        await settledAt(start("/account", signedInServer("user", true)), "/consent?next=%2Faccount", "consent");
    });

    it("身份只在第一次导航时取，之后的导航用缓存", async () => {
        const started = start("/account", signedInServer("user"));
        await settledAt(started, "/account", "account");
        await started.site.router.push("/privacy");
        await settledAt(started, "/privacy", "privacy");
        expect(started.requested).toEqual([WHOAMI, ME]);
    });
});

describe("没有这一页", () => {
    it("没有的地址显示“没有这一页”与回首页的链接；管理面板下没有的地址也一样，不先要求登录", async () => {
        for (const path of ["/no-such-page", "/admin/no-such-page"]) {
            const started = start(path, anonymousServer());
            await settledAt(started, path, "not-found");
            const page = started.target.querySelector('[data-site-page="not-found"]')!;
            expect(page.querySelector("h1")?.textContent).toBe(zhCN.notFound.title);
            expect(page.querySelector("a")?.getAttribute("href")).toBe("/");
            expect(page.querySelector("a")?.textContent).toBe(zhCN.notFound.home);
        }
    });
});

describe("取不到身份", () => {
    it("账号服务不可用时整页提示、不画页面；重试成功后按身份走守卫", async () => {
        const started = start("/account", {...anonymousServer(), whoami: () => Response.json({error: {code: "unavailable"}}, {status: 503})});
        await vi.waitFor(() => expect(started.target.querySelector("[data-site-unavailable]")).not.toBeNull());
        const alert = started.target.querySelector("[data-site-unavailable]")!;
        expect(alert.getAttribute("role")).toBe("alert");
        expect(alert.textContent).toContain(zhCN.shell.unavailable);
        expect(started.target.querySelector("[data-site-page]")).toBeNull();

        started.server.whoami = anonymousServer().whoami;
        alert.querySelector("button")!.click();
        await settledAt(started, "/login?next=%2Faccount", "login");
        expect(started.target.querySelector("[data-site-unavailable]")).toBeNull();
    });

    it("重试时取到了身份、跳转却失败：仍挡着页面、写明没能打开，再点重试能进", async () => {
        const started = start("/account", {...anonymousServer(), whoami: () => Response.json({error: {code: "unavailable"}}, {status: 503})});
        await vi.waitFor(() => expect(started.target.querySelector("[data-site-unavailable]")).not.toBeNull());

        started.server.whoami = anonymousServer().whoami;
        // 页面的块加载失败、守卫出错都表现为跳转 reject；用路由的公开接口加一个会抛错的守卫造出来。
        const removeBrokenGuard = started.site.router.beforeEach(() => {
            throw new Error("测试造的跳转失败");
        });
        started.target.querySelector<HTMLButtonElement>("[data-site-unavailable] button")!.click();
        await vi.waitFor(() => {
            const alert = started.target.querySelector("[data-site-unavailable]");
            expect(alert?.textContent).toContain(zhCN.shell.navigationFailed);
            expect(alert?.querySelector("button")?.disabled).toBe(false);
        });
        expect(started.site.account.state.value).toEqual({kind: "anonymous"});
        expect(started.target.querySelector("[data-site-page]")).toBeNull();

        removeBrokenGuard();
        started.target.querySelector<HTMLButtonElement>("[data-site-unavailable] button")!.click();
        await settledAt(started, "/login?next=%2Faccount", "login");
        expect(started.target.querySelector("[data-site-unavailable]")).toBeNull();
    });
});

describe("按码统一处理之后的跳转", () => {
    it("管理接口回 forbidden：重取身份，角色已改成普通用户时分派到账号页", async () => {
        const started = start("/admin/users", signedInServer("admin"));
        await settledAt(started, "/admin/users", "admin-users");

        Object.assign(started.server, {...signedInServer("user"), other: () => Response.json({error: {code: "forbidden"}}, {status: 403})});
        const result = await started.site.api.request({method: "GET", path: ADMIN_USERS});
        expect(result).toEqual({ok: false, failure: {kind: "code", status: 403, code: "forbidden", handled: true}});
        await settledAt(started, "/account", "account");
        expect(started.requested).toEqual([WHOAMI, ME, ADMIN_USERS, WHOAMI, ME]);
    });

    it("某个请求回 unauthenticated：当作匿名，带着当前地址去登录", async () => {
        const started = start("/account", signedInServer("user"));
        await settledAt(started, "/account", "account");

        started.server.other = () => Response.json({error: {code: "unauthenticated"}}, {status: 401});
        await started.site.api.request({method: "GET", path: `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.meSessions}`});
        await settledAt(started, "/login?next=%2Faccount", "login");
        expect(started.site.account.state.value).toEqual({kind: "anonymous"});
    });

    it("某个请求撞上同意门槛：重取身份，带着当前地址去同意页", async () => {
        const started = start("/account", signedInServer("user"));
        await settledAt(started, "/account", "account");

        Object.assign(started.server, {...signedInServer("user", true), other: () => Response.json({error: {code: "consent_required"}}, {status: 403})});
        await started.site.api.request({method: "GET", path: `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.meSessions}`});
        await settledAt(started, "/consent?next=%2Faccount", "consent");
    });

    it("访客页上的请求回 consent_required（注册时没勾同意）：不跳转、不重取身份，失败交给页面", async () => {
        const started = start("/register", anonymousServer());
        await settledAt(started, "/register", "register");

        started.server.other = () => Response.json({error: {code: "consent_required"}}, {status: 403});
        // 注册接口忘了在 `handles` 里声明它：统一处理在访客页上照样不接管。
        const result = await started.site.api.request({method: "POST", path: `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.register}`, body: {}});
        expect(result).toEqual({ok: false, failure: {kind: "code", status: 403, code: "consent_required"}});
        // 接管时第一步是同步发出的重取身份（`whoami`）：请求清单里没有它，就是没接管。
        expect(started.requested).toEqual([WHOAMI, `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.register}`]);
        expect(started.site.router.currentRoute.value.fullPath).toBe("/register");
    });
});
