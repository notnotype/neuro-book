/**
 * 稿纸页组件测试的装置：装起整个站点（`startSite`，真实的路由、守卫、接口层、当前账号与存储），账号服务由注入的 `fetch` 按
 * 方法与路径回答，时间由手动时钟推进，离开站点（`leave`）记下地址。回答都按合同包的类型写，写错形状类型检查就不过。
 * 没准备的请求记进 `unexpected`，由用例在结束时断言为空。
 *
 * 只给测试导入；产品代码不导入它，所以不进构建产物。
 */

import {IDENTITY_API_PREFIX, IDENTITY_PATHS} from "@notnotype/nb-site-identity-contract/constants";
import type {ErrorBody, MeResponse, MetaResponse, PublicProfile, WhoamiResponse} from "@notnotype/nb-site-identity-contract/constants";
import {expect, vi} from "vitest";
import {createMemoryHistory} from "vue-router";

import {startSite} from "../site";
import {EMPTY_ADMIN_LISTS} from "./admin-answers";
import {dashboardBodies, EMPTY_DASHBOARD} from "./dashboard-answers";
import type {Site} from "../site";
import {manualClock} from "./manual-clock";
import type {ManualClock} from "./manual-clock";

export const identityUrl = (relative: string): string => `${IDENTITY_API_PREFIX}${relative}`;

/** 账号页读的四份列表（`pages/account/account-lists.ts`）。 */
const ACCOUNT_LISTS = new Set([IDENTITY_PATHS.meSessions, IDENTITY_PATHS.meIdentities, IDENTITY_PATHS.meInviteCodes, IDENTITY_PATHS.meGrants].map(identityUrl));

/** 管理员登录之后落在看板上，它一打开就读的那几份（`pages/admin/dashboard/source.ts`）。 */
const EMPTY_DASHBOARD_BODIES = dashboardBodies(EMPTY_DASHBOARD);

/** 用例里的“现在”。草稿的写入时刻、`Retry-After` 的倒数都从这里算。 */
export const NOW = Date.parse("2026-11-26T10:00:00Z");

/** 当前条款版本。 */
export const TERMS_VERSION = "2026-11-01";

export const OPEN_META: MetaResponse = {termsVersion: TERMS_VERSION, registrationOpen: true, providers: {google: true, github: true}};

export type Role = MeResponse["role"];

export interface Session {
    role: Role;
    consentRequired: boolean;
    /** `GET me` 的回答；缺省按 `role` 与 `consentRequired` 拼一份有邮箱、有密码的。账号页的用例在这里换成别的账号，改资料的回答也写回这里。 */
    me?: MeResponse;
}

export function profile(role: Role): PublicProfile {
    return {id: 7, username: "alice", displayName: "Alice", avatarUrl: null, website: null, bio: null, role, createdAt: "2026-11-01T00:00:00.000Z"};
}

export function me(session: Session): MeResponse {
    if (session.me !== undefined) return session.me;
    return {...profile(session.role), email: "alice@example.com", emailPending: false, hasPassword: true, consentRequired: session.consentRequired};
}

export const failure = (body: ErrorBody, status: number, headers?: HeadersInit): Response => Response.json(body, {status, headers});

/** 一次请求：方法、路径与解析过的请求体（没有请求体时是 `undefined`）。 */
export interface Request {
    readonly method: string;
    readonly path: string;
    readonly body: unknown;
}

/**
 * 某个 `方法 路径` 的回答。`server` 是同一个账号服务：成功的注册、登录、补交同意在这里改会话，像 `Set-Cookie` 那样。
 * `query` 是请求的查询参数：管理面板的列表按它分页、筛选，处理器的键只写路径不写查询串。
 */
export type Handler = (body: unknown, server: Server, query: URLSearchParams) => Response | Promise<Response>;

export interface Server {
    /** 浏览器带着的会话；`undefined` 是匿名。 */
    session: Session | undefined;
    /** `GET meta` 的回答；回 `Promise` 的可以让它晚到。 */
    meta: () => Response | Promise<Response>;
    /** 其余接口，键是 `"POST /api/identity/v1/register"` 这样的写法；带查询串的请求先找连查询串的键，没有再找只写路径的。 */
    readonly handlers: Map<string, Handler>;
}

export interface Harness {
    readonly site: Site;
    readonly target: HTMLElement;
    readonly server: Server;
    readonly clock: ManualClock;
    /** 除了 `GET whoami`、`GET me` 之外的请求，按发出的先后。 */
    readonly requests: Request[];
    /** `leave` 收到的地址，与那一刻存储里社交注册草稿的原文（没有时是 `null`）：看得出跳走之前有没有写草稿。 */
    readonly left: {readonly url: string; readonly draft: string | null}[];
}

/** 社交注册草稿在 `sessionStorage` 里的键（计划 3.9）。测试按它读写原文，看存进去的到底是什么。 */
export const DRAFT_KEY = "nb-site.social-register-draft";

const started: Site[] = [];
const unexpected: string[] = [];

/** 每条用例结束时调用：停掉站点、清空页面与存储，断言没有没准备的请求。 */
export function cleanUp(): void {
    for (const site of started.splice(0)) site.stop();
    document.body.replaceChildren();
    window.sessionStorage.clear();
    expect(unexpected.splice(0)).toEqual([]);
}

/** 停掉一个站点而不清存储：像整页离开再回来，之间 `sessionStorage` 里的东西还在。 */
export function stopKeepingStorage(harness: Harness): void {
    const index = started.indexOf(harness.site);
    if (index >= 0) started.splice(index, 1);
    harness.site.stop();
    harness.target.remove();
}

export interface StartOptions {
    readonly session?: Session;
    readonly meta?: MetaResponse | (() => Response | Promise<Response>);
    readonly handlers?: Readonly<Record<string, Handler>>;
    /** 时钟的起点；缺省是 `NOW`。 */
    readonly now?: number;
}

export function startAt(path: string, options: StartOptions = {}): Harness {
    const target = document.createElement("div");
    document.body.append(target);
    const history = createMemoryHistory();
    history.replace(path);
    const metaOption = options.meta ?? OPEN_META;
    const server: Server = {
        session: options.session === undefined ? undefined : {...options.session},
        meta: typeof metaOption === "function" ? metaOption : () => Response.json(metaOption),
        handlers: new Map(Object.entries(options.handlers ?? {})),
    };
    const requests: Request[] = [];
    const left: {url: string; draft: string | null}[] = [];
    const clock = manualClock(options.now ?? NOW);
    const site = startSite({
        target,
        window,
        history,
        clock,
        leave: (url) => left.push({url, draft: window.sessionStorage.getItem(DRAFT_KEY)}),
        fetch: async (input, init) => {
            const method = String(init.method ?? "GET");
            // 只有读的 `GET` 由装置自己答：账号页还会对 `me` 发 `PATCH`，那是用例要准备、要看见的请求。
            if (method === "GET" && input === identityUrl(IDENTITY_PATHS.whoami)) {
                const session = server.session;
                return Response.json((session === undefined ? {state: "anonymous"} : {state: "authenticated", user: {id: 7, username: "alice", role: session.role}}) satisfies WhoamiResponse);
            }
            if (method === "GET" && input === identityUrl(IDENTITY_PATHS.me)) {
                return server.session === undefined ? failure({error: {code: "unauthenticated"}}, 401) : Response.json(me(server.session));
            }
            const body: unknown = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
            requests.push({method, path: input, body});
            if (method === "GET" && input === identityUrl(IDENTITY_PATHS.meta)) return server.meta();
            const url = new URL(input, "http://site.invalid");
            const handler = server.handlers.get(`${method} ${input}`) ?? server.handlers.get(`${method} ${url.pathname}`);
            if (handler !== undefined) return handler(body, server, url.searchParams);
            // 登录、注册、补交同意之后都落在账号页，它一打开就读这四份列表。在乎列表内容的用例自己准备处理器，其余的回空列表。
            if (method === "GET" && ACCOUNT_LISTS.has(input)) return Response.json({items: []});
            // 看板同理：管理员登录之后落在看板上，在乎看板数据的用例用 `dashboardHandlers` 准备，其余的回一份还没有上报的看板。
            // 只替管理员的会话回：别的会话不该发这些请求，发了就记进 `unexpected`。
            const dashboard = method === "GET" && server.session?.role === "admin" ? EMPTY_DASHBOARD_BODIES.get(input) : undefined;
            if (dashboard !== undefined) return Response.json(dashboard);
            // 管理面板的几个列表同理：在乎列表的用例自己准备，其余的回一页空的。
            const adminList = method === "GET" && server.session?.role === "admin" ? EMPTY_ADMIN_LISTS.get(url.pathname) : undefined;
            if (adminList !== undefined) return Response.json(adminList);
            unexpected.push(`${method} ${input}`);
            return failure({error: {code: "not_found"}}, 404);
        },
    });
    started.push(site);
    return {site, target, server, clock, requests, left};
}

/**
 * 等页面落定的上限。页面按需加载，第一次进某一页时测试环境要现编译它的块：看板连同 ECharts 与几个图表组件单独跑约 1 秒，
 * 几个测试文件并行、别的进程占着 CPU 时能到好几秒，超过 `vi.waitFor` 缺省的 1 秒。等的仍是路由与页面这两个可观察的状态，
 * 到了就往下走。要小于单条用例的上限（`vitest.config.ts` 的 `testTimeout`）：用例先被截停的话，报的是“Test timed out”，
 * 看不到路由停在哪、页面有没有画出来。
 */
export const SETTLE_TIMEOUT_MS = 10_000;

/**
 * 等到路由停在 `fullPath`、页面画出 `page`。vue-router 对查询串另有一套编码，所以比的是解码后的路径与查询参数。
 */
export async function settledAt({site, target}: Pick<Harness, "site" | "target">, fullPath: string, page: string): Promise<void> {
    const url = new URL(fullPath, "http://site.invalid");
    const expected = {path: url.pathname, query: Object.fromEntries(url.searchParams)};
    await vi.waitFor(() => {
        const route = site.router.currentRoute.value;
        expect({path: route.path, query: route.query}).toEqual(expected);
        expect(target.querySelector(`[data-site-page="${page}"]`)).not.toBeNull();
    }, {timeout: SETTLE_TIMEOUT_MS});
}

/**
 * 让出一轮事件循环。装置里的路由导航、注入的 `fetch` 与之后的重画都只排微任务，这之后已经跑完：断言“还没有导航、还没有取”
 * 之前先等它，不然只是导航还没来得及发生（vue-router 的导航是异步的，连着几次 `replace` 还会互相取消，只剩最后一次）。
 */
export function nextTask(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 像用户那样改一个输入框：写值、发 `input`；`change` 在离开时由 `blur` 之前发（`leaveField`）。 */
export function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event("input", {bubbles: true}));
}

/** 离开输入框：浏览器先发 `change`（值改过时），再发 `blur` 与会冒泡的 `focusout`。 */
export function leaveField(input: HTMLInputElement): void {
    input.dispatchEvent(new Event("change", {bubbles: true}));
    input.dispatchEvent(new FocusEvent("blur"));
    input.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
}

/** 状态行上看得见的字：去掉只给读屏的那句。 */
export function statusTextOf(status: HTMLElement): string {
    const copy = status.cloneNode(true) as HTMLElement;
    for (const spoken of copy.querySelectorAll("[data-site-form-status-spoken]")) spoken.remove();
    return copy.textContent?.trim() ?? "";
}

/** 表单里标红的项（`aria-invalid`），按 `name`、按表单里的先后。 */
export function invalidNames(form: HTMLElement): string[] {
    return [...form.querySelectorAll<HTMLInputElement>('input[aria-invalid="true"]')].map((input) => input.name);
}

/** 社交图标，按画出来的先后。 */
export function socialButtons(target: HTMLElement): HTMLButtonElement[] {
    return [...target.querySelectorAll<HTMLButtonElement>("[data-site-social-provider]")];
}

export function socialButton(target: HTMLElement, provider: "github" | "google"): HTMLButtonElement {
    const button = target.querySelector<HTMLButtonElement>(`[data-site-social-provider="${provider}"]`);
    if (button === null) throw new Error(`没有 ${provider} 的图标`);
    return button;
}
