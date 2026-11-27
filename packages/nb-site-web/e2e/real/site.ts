/**
 * 真实冒烟的底座（t10 计划 3.10 的“真实冒烟”，段 B 第 10 片）：起真的 `nb-site serve`，由它发出本次构建的 `dist/`，浏览器经 HTTPS
 * 以 `https://site.test` 打开。起进程、造管理员、扮演 OAuth 客户端用合同测试包的 `./testing`，与合同测试同一套（环境不继承本进程、
 * 收口按进程号停）。
 *
 * 浏览器怎么看到 https 的站点（B10 探针的结论，探针脚本与输出在 Task 的实验目录）：
 * - 选的是“本地 TLS 转发 + Chrome 的 `--host-resolver-rules` + `ignoreHTTPSErrors`”。本文件在回环上起一个 HTTPS 服务（证书由
 *   `openssl` 现签，CN 与 SAN 都是 `site.test`），原样把请求转给被测进程（`Host`、`Origin`、`Cookie` 不改），原样转回响应；
 *   Chrome 把 `site.test` 解析到这个服务。浏览器看到的是真的 https 源，Cookie、跳转、`Origin` 都由它自己处理。
 * - 没选 `context.route` 加 `fulfill`：探针里它在 Cookie 上是对的（`Secure`、`HttpOnly`、`SameSite=Lax` 的 `__Host-` 会话 Cookie
 *   存进 `site.test`、下次带上，登录的 `Origin` 是 `https://site.test`），但 `fulfill` 回 302 时 Chrome 的整页导航直接失败
 *   （`net::ERR_CONNECTION_CLOSED` 或 `ERR_NAME_NOT_RESOLVED`，相对、绝对的 `Location`，302、303 都一样），授权端点的跳转走不通；
 *   `route.fetch` 还会把 `Set-Cookie` 记进 context 自己的 Cookie 罐（按 `127.0.0.1` 另存一份），转发时要绕开它。
 * - `--no-proxy-server`：本机的 shell 里设着 `http_proxy`（开发机的代理），Chrome 会照它把 `site.test` 发给代理，代理直接断开连接。
 *
 * 每个用例一个新的数据目录、一个新的进程（`server` fixture）：限流按来源计（转发后来源都是 127.0.0.1），用例之间不共用状态。
 */

import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {request as httpRequest} from "node:http";
import {createServer, type Server} from "node:https";
import type {AddressInfo} from "node:net";
import {join, resolve} from "node:path";

import {expect, test as base} from "@playwright/test";
import type {Browser, BrowserContext, Page, Response} from "@playwright/test";

import {createAdmin, createSiteSandbox, SANDBOX_SITE_URL, type Env, type ManagedSiteSandbox, type SiteProcess} from "@notnotype/nb-site-contract-tests/testing";

/** 被测进程发出的前端产物：本次构建的 `dist/`（`test:e2e` 先构建）。 */
export const WEB_DIR = resolve(import.meta.dirname, "..", "..", "dist");

/** 站点的中文目录：断言里的文字从这里取，改文案时场景不跟着坏（与假接口的场景同一种做法）。 */
export const zhCN = JSON.parse(readFileSync(new URL("../../src/locales/zh-CN.json", import.meta.url), "utf8")) as {
    readonly consent: {readonly version: string};
    readonly legal: {readonly version: string};
    readonly account: {readonly saved: string; readonly menu: string; readonly signOut: string; readonly profile: {readonly bio: string}};
    readonly errors: {readonly identity: Readonly<Record<string, string>>};
};

/** 管理面板的中文目录（`src/pages/admin/locales/`）。 */
export const adminZhCN = (
    JSON.parse(readFileSync(new URL("../../src/pages/admin/locales/zh-CN.json", import.meta.url), "utf8")) as {
        readonly admin: {
            readonly list: {readonly done: string};
            readonly codes: {readonly issue: {readonly open: string; readonly title: string; readonly note: string; readonly submit: string; readonly doneTitle: string}};
            readonly users: {readonly rowActions: string; readonly banned: string; readonly actions: {readonly ban: {readonly menu: string; readonly title: string; readonly confirm: string}}};
            readonly clients: {
                readonly form: {readonly name: string; readonly redirectUris: string};
                readonly register: {readonly open: string; readonly title: string; readonly submit: string; readonly doneTitle: string};
            };
        };
    }
).admin;

/** 目录里 `{{名字}}` 的插值，与站点的 i18next 同一种写法。 */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
    return template.replace(/\{\{(\w+)\}\}/gu, (whole, name: string) => values[name] ?? whole);
}

/**
 * 条款正文 front matter 里的版本（隐私政策与服务条款是同一个版本）。被测进程用它作 `NB_SITE_IDENTITY_TERMS_VERSION`：
 * 发布时两边要一致（`site/identity` 的 S5），冒烟按一致的配置起。
 */
export const LEGAL_VERSION = legalVersion();

function legalVersion(): string {
    const versions = ["privacy", "terms"].map((name) => {
        const text = readFileSync(resolve(import.meta.dirname, "..", "..", "src", "legal", "zh-CN", `${name}.md`), "utf8");
        const version = /^---\n(?:.*\n)*?version:\s*(\S+)\n/u.exec(text)?.[1];
        if (version === undefined) throw new Error(`src/legal/zh-CN/${name}.md has no version in its front matter`);
        return version;
    });
    if (versions[0] !== versions[1]) throw new Error(`the privacy policy (${versions[0]!}) and the terms (${versions[1]!}) have different versions`);
    return versions[0]!;
}

export const ADMIN = {username: "admin", email: "admin@example.test", password: "admin-password-1"} as const;

/** 浏览器里收到的问题：CSP 拦下的、页面没接住的异常与 Promise。预期的 4xx 在控制台留的 `Failed to load resource` 不算。 */
export interface BrowserProblems {
    readonly problems: string[];
    /** 收到的 `Set-Cookie`，值换成 `…`，留名字与属性给断言与报告。 */
    readonly setCookies: string[];
}

/** 转发服务：把 `site.test` 上的 HTTPS 请求转给当前的被测进程。进程重启后换 `target`。 */
interface Forwarder {
    readonly port: number;
    target: URL | undefined;
    close(): Promise<void>;
}

async function startForwarder(directory: string): Promise<Forwarder> {
    const key = join(directory, "site.test.key");
    const cert = join(directory, "site.test.crt");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=site.test", "-addext", "subjectAltName=DNS:site.test"], {stdio: "pipe"});
    const forwarder: {target: URL | undefined} = {target: undefined};
    const server: Server = createServer({key: readFileSync(key), cert: readFileSync(cert)}, (request, response) => {
        const target = forwarder.target;
        if (target === undefined) {
            response.writeHead(502, {"content-type": "text/plain"}).end("no site process is running");
            return;
        }
        // `agent: false`：每个请求一条新连接。进程重启后旧的长连接指向已经退出的进程，复用它会让重启后的第一个请求失败。
        const upstream = httpRequest({host: target.hostname, port: target.port, method: request.method, path: request.url, headers: request.headers, agent: false}, (answer) => {
            response.writeHead(answer.statusCode ?? 502, answer.rawHeaders);
            answer.pipe(response);
        });
        upstream.on("error", (error) => {
            if (!response.headersSent) response.writeHead(502, {"content-type": "text/plain"});
            response.end(`forwarding failed: ${error.message}`);
        });
        request.pipe(upstream);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    return {
        port: (server.address() as AddressInfo).port,
        get target() {
            return forwarder.target;
        },
        set target(value) {
            forwarder.target = value;
        },
        close: () => new Promise<void>((done) => server.close(() => done())),
    };
}

/** 一个用例的被测进程：同一个数据目录可以带着新的环境重启，会话 Cookie 照样有效（会话密钥整个沙箱不变）。 */
export class SiteServer {
    #process: SiteProcess | undefined;

    constructor(
        private readonly sandbox: ManagedSiteSandbox,
        private readonly forwarder: Forwarder,
        readonly dataDir: string,
    ) {}

    get process(): SiteProcess {
        if (this.#process === undefined) throw new Error("the site process is not running");
        return this.#process;
    }

    /** 起 `serve`，等到就绪，把转发指过去。`env` 盖在缺省之上（发网页、按条款正文的版本）。 */
    async start(env: Env = {}): Promise<void> {
        const process = await this.sandbox.start({dataDir: this.dataDir, env: {...serverEnv(), ...env}});
        await process.ready();
        this.#process = process;
        this.forwarder.target = new URL(process.url);
    }

    /** 停掉再起：换配置（例如条款版本）时用。 */
    async restart(env: Env = {}): Promise<void> {
        this.forwarder.target = undefined;
        const exitCode = await this.process.stop();
        expect(exitCode).toBe(0);
        this.#process = undefined;
        await this.start(env);
    }
}

function serverEnv(): Env {
    return {NB_SITE_WEB_DIR: WEB_DIR, NB_SITE_IDENTITY_TERMS_VERSION: LEGAL_VERSION};
}

interface WorkerFixtures {
    readonly realSite: {readonly sandbox: ManagedSiteSandbox; readonly forwarder: Forwarder};
}

interface TestFixtures {
    /** 本用例的被测进程，已经起好、管理员已经造好（还没同意条款，第一次登录先到同意页）。 */
    readonly server: SiteServer;
    /** 开一个新的浏览器（新的 context，Cookie 各自独立），收集它的问题；用例结束时断言没有问题。 */
    readonly openPage: () => Promise<Page>;
    readonly problems: BrowserProblems;
}

/** 页面里登记的监听：CSP 拦下时写一条带标记的控制台错误，Playwright 的控制台事件就能收到（`pageerror` 不报 CSP）。 */
const PROBLEM_MARK = "[nb-site-web real smoke]";

export const test = base.extend<TestFixtures, WorkerFixtures>({
    realSite: [
        async ({}, use, workerInfo) => {
            // Playwright 的 worker 自己接住 SIGINT、SIGTERM，等主进程叫它跑完夹具的收尾（下面的 finally）：底座不装那两个信号的兜底。
            const sandbox = createSiteSandbox(`nb-site-web e2e/real worker ${String(workerInfo.workerIndex)}`, {handleSignals: false});
            await sandbox.open();
            let forwarder: Forwarder | undefined;
            try {
                forwarder = await startForwarder(sandbox.root);
                await use({sandbox, forwarder});
            } finally {
                await forwarder?.close();
                await sandbox.close();
            }
        },
        {scope: "worker"},
    ],

    // 覆盖内置的 browser：要先知道转发服务的端口，才能把 `site.test` 解析到它。浏览器的种类、有没有窗口与别的启动选项照配置
    // 与命令行（`--headed`、`PWDEBUG`），与内置的一样。
    browser: [
        async ({playwright, realSite, channel, headless, launchOptions}, use) => {
            const browser: Browser = await playwright.chromium.launch({
                ...launchOptions,
                ...(channel === undefined ? {} : {channel}),
                headless,
                args: [...(launchOptions.args ?? []), "--no-proxy-server", `--host-resolver-rules=MAP site.test 127.0.0.1:${String(realSite.forwarder.port)}`],
            });
            try {
                await use(browser);
            } finally {
                await browser.close();
            }
        },
        {scope: "worker"},
    ],

    server: async ({realSite}, use) => {
        const {sandbox, forwarder} = realSite;
        sandbox.beginTest();
        try {
            const server = new SiteServer(sandbox, forwarder, await sandbox.dataDir());
            await createAdmin({run: (command, options) => sandbox.run(command, {...options, env: {...serverEnv(), ...options?.env}})}, server.dataDir, [ADMIN.username, ADMIN.email], ADMIN.password);
            await server.start();
            await use(server);
        } finally {
            forwarder.target = undefined;
            await sandbox.endTest();
        }
    },

    problems: async ({}, use) => {
        const problems: BrowserProblems = {problems: [], setCookies: []};
        await use(problems);
        expect(problems.problems).toEqual([]);
    },

    openPage: async ({browser, problems}, use, testInfo) => {
        const contexts: BrowserContext[] = [];
        await use(async () => {
            const context = await browser.newContext({ignoreHTTPSErrors: true, viewport: {width: 1440, height: 900}, reducedMotion: "reduce", baseURL: SANDBOX_SITE_URL});
            contexts.push(context);
            await watch(context, problems);
            return context.newPage();
        });
        await testInfo.attach("set-cookie", {body: problems.setCookies.join("\n"), contentType: "text/plain"});
        for (const context of contexts) await context.close();
    },
});

async function watch(context: BrowserContext, problems: BrowserProblems): Promise<void> {
    await context.addInitScript((mark) => {
        window.addEventListener("securitypolicyviolation", (event) => {
            console.error(`${mark} csp ${event.violatedDirective} blocked ${event.blockedURI || "inline"} at ${event.sourceFile}:${String(event.lineNumber)}`);
        });
    }, PROBLEM_MARK);
    context.on("console", (message) => {
        const text = message.text();
        if (text.includes(PROBLEM_MARK) || /Content Security Policy|Refused to/u.test(text)) problems.problems.push(`console: ${text}`);
    });
    context.on("weberror", (error) => problems.problems.push(`page error: ${error.error().message}`));
    context.on("response", (response) => void recordSetCookies(response, problems));
}

async function recordSetCookies(response: Response, problems: BrowserProblems): Promise<void> {
    const headers = await response.headersArray().catch(() => []);
    for (const header of headers) {
        if (header.name.toLowerCase() !== "set-cookie") continue;
        problems.setCookies.push(`${new URL(response.url()).pathname}: ${header.value.replace(/^([^=]+)=[^;]*/u, "$1=…")}`);
    }
}

export {expect};

/** 在登录页填用户名与密码、提交。 */
export async function signIn(page: Page, identifier: string, password: string): Promise<void> {
    await page.locator('input[name="identifier"]').fill(identifier);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('[data-site-paper-card] button[type="submit"]').click();
}

/**
 * 两项同意都勾上：像用户那样点方框（nb-ui 的勾选框把 input 做成只给读屏的，上面盖着 label，`check()` 会被挡住；
 * 与 `register.e2e.ts` 同一种点法）。
 */
export async function agreeToBoth(page: Page): Promise<void> {
    for (const name of ["termsConsent", "overseasStorage"]) {
        await page.locator(`label:has(> input[name="${name}"]) > span`).first().click();
        await expect(page.locator(`input[name="${name}"]`)).toBeChecked();
    }
}

/** 新造的管理员第一次登录：登录、在同意页同意，到管理面板。 */
export async function signInAdmin(page: Page): Promise<void> {
    await page.goto("/login");
    await signIn(page, ADMIN.username, ADMIN.password);
    await expect(page.locator('[data-site-page="consent"]')).toBeVisible();
    await agreeToBoth(page);
    await page.locator('[data-site-paper-card] button[type="submit"]').click();
    await expect(page.locator('[data-site-page="admin-dashboard"]')).toBeVisible();
}

/** 管理员在注册码页发一个注册码，返回码。 */
export async function issueRegistrationCode(page: Page, note: string): Promise<string> {
    await page.goto("/admin/codes");
    const text = adminZhCN.codes.issue;
    await page.getByRole("button", {name: text.open}).click();
    const dialog = page.getByRole("dialog", {name: text.title});
    await dialog.getByRole("textbox", {name: text.note}).fill(note);
    await dialog.getByRole("button", {name: text.submit, exact: true}).click();
    const done = page.getByRole("dialog", {name: text.doneTitle});
    const code = (await done.locator("code").textContent())?.trim() ?? "";
    expect(code).toMatch(/^[A-Z0-9]{8,}$/u);
    await done.getByRole("button", {name: adminZhCN.list.done}).click();
    await expect(done).toBeHidden();
    return code;
}

/** 访客用注册码注册，停在账号页。 */
export async function register(page: Page, code: string, username: string, password: string): Promise<void> {
    await page.goto("/register");
    await page.locator('input[name="registrationCode"]').fill(code);
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="email"]').fill(`${username}@example.test`);
    await page.locator('input[name="password"]').fill(password);
    await agreeToBoth(page);
    await page.locator('[data-site-paper-card] button[type="submit"]').click();
    await expect(page.locator('[data-site-page="account"]')).toBeVisible();
}
