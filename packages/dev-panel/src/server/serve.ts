import {randomBytes, timingSafeEqual} from "node:crypto";
import {readFile} from "node:fs/promises";
import type {Server, ServerWebSocket} from "bun";
import type {HerdrClient} from "../herdr/client.js";
import {NbdevError, isNbdevError, systemErrorCode, type Warning} from "../core/errors.js";
import type {RepoContext} from "../core/repo.js";
import {createNameIndexCache, searchCheckouts, validateSearchQuery} from "../core/search.js";
import {createPanelAuth, type PanelAuth} from "./auth.js";
import {ANSWER_BRIDGE_FILE, answerBridgeScript, injectAnswerBridge} from "./artifact-bridge.js";
import {allowedHosts, contentType, decodePath, guardedFile, rejectForwarded, rejectHost, sameHostOn, type Rejection} from "./guard.js";
import {PanelState, type PartName} from "./state.js";
import {assertMainWritable} from "../core/repo.js";
import {artifactsView, artifactView, docDiffView, docFileView, docsTreeView, fileView, NotReady, overviewView, recordMatches, sessionsView, taskView, workView} from "./views.js";
import {createWriteHandler, readFields, statusOf} from "./writes.js";
import {auditPaths, createAuditWriter, readAuditStatus} from "../core/audit.js";
import {AUTO_NOTIFY_VERSIONS, Notifier, PaneLocks} from "./notifier.js";
import {ControlRegistry} from "./control-registry.js";
import {newConnectionId, TerminalHub, type TerminalSocketData, type TerminalTimings} from "./terminal-hub.js";
import {resolveTerminalTools} from "./terminal-stream.js";
import {createSessionIo} from "./session-io.js";
import {GithubCache} from "./github.js";
import {CheckoutStatusCache, checkoutsView, githubView, runsView} from "./live-views.js";
import {createSessionTitles} from "./session-titles.js";

/**
 * 面板服务：两个来源（`Bun.serve` 各一个）。
 * - 面板 `127.0.0.1:<port>`：前端页面、`/api/*` 的 JSON、`/ws` 的推送、`/login` 的一次性登录；
 * - 产物 `127.0.0.1:<artifactPort>`：只读的静态文件，地址带服务启动时生成的随机前缀，只给 `.agents/works/` 下的文件。
 * 合同见 docs/panel.md。
 */

export const PANEL_API_SCHEMA = "nbdev.panel-api/v1";
/** 产物来源上的保留路径：放页面里答题用的脚本（t23），别的都回 404；不让它与 checkout key 撞名。 */
export const RESERVED_ARTIFACT_SEGMENT = "_nbdev";

export type PanelServerOptions = {
    context: RepoContext;
    host: string;
    port: number;
    artifactPort: number;
    herdr: HerdrClient | null;
    token: string;
    log: (message: string) => void;
    /** 审计的位置（`XDG_CONFIG_HOME`、`HOME`）与作为服务运行时的单元名（`NBDEV_PANEL_UNIT`）从这里取；测试指到临时根。 */
    env: NodeJS.ProcessEnv;
    /** 网页终端接管的时限（缺省见 `terminal-hub.ts`）；只有测试会改。 */
    terminalTimings?: Partial<TerminalTimings>;
};

export type PanelServer = {
    readonly url: string;
    readonly artifactUrl: string;
    readonly port: number;
    readonly artifactPort: number;
    readonly instanceId: string;
    readonly state: PanelState;
    readonly auth: PanelAuth;
    /** 前端产物目录（构建或测试注入之后才有）；没有时页面回 503。 */
    setStatic(dir: string, build: {failed: string | null}): Promise<void>;
    /** 预热（记录与活动各算一遍）并开始监视；之前 `/api/*` 回 503。预热中途已经 `stop()` 时不挂监视，返回 false。 */
    warm(): Promise<boolean>;
    stop(): Promise<void>;
};

/** `/ws`（推送）与 `/ws/terminal`（网页终端）共用一组 websocket 回调，按连接种类分派。 */
type SocketData = {kind: "panel"; instance: string} | TerminalSocketData;

const SECURITY_HEADERS = {"X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store"};

function plain(status: number, text: string, extra: Record<string, string> = {}): Response {
    return new Response(`${text}\n`, {status, headers: {...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8", ...extra}});
}

function rejection(result: Rejection): Response {
    return plain(result.status, `${result.code}：${result.message}`);
}

function isRejection(value: unknown): value is Rejection {
    return typeof value === "object" && value !== null && "status" in value && "code" in value;
}

function equalSecret(given: string | null, expected: string): boolean {
    if (given === null) return false;
    const left = Buffer.from(given);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
}

export async function startPanelServer(options: PanelServerOptions): Promise<PanelServer> {
    const {context, host, log} = options;
    const state = new PanelState(context, options.herdr, log, createSessionTitles(options.env, log));
    // cookie 名带上面板端口：cookie 不按端口区分，同一个浏览器登录第二个面板时同名 cookie 会把第一个踢下线。
    const auth = createPanelAuth(options.token, () => `nbdev_panel_${panelPort()}`);
    const csrf = randomBytes(24).toString("base64url");
    const artifactPrefix = randomBytes(18).toString("base64url");
    const names = createNameIndexCache();
    let staticDir: string | null = null;
    let indexHtml: string | null = null;
    let ready = false;
    let currentSearch: AbortController | null = null;
    const sockets = new Set<ServerWebSocket<SocketData>>();

    let panel: Server<SocketData> | null = null;
    let artifacts: Server<undefined> | null = null;
    const listen = <T>(port: number, create: (port: number) => Server<T>): Server<T> => {
        try {
            return create(port);
        } catch (error) {
            if (systemErrorCode(error) === "EADDRINUSE") {
                throw new NbdevError("port_in_use", `端口 ${port} 已被占用；换一个端口（--port、--artifact-port）或先停掉占用它的进程`, {details: {port}});
            }
            if (systemErrorCode(error) === "EADDRNOTAVAIL") {
                throw new NbdevError("unsafe_host", `这台机器上绑不了 ${host}（地址不可用）；用 127.0.0.1`, {details: {host, port}});
            }
            throw error;
        }
    };

    const panelPort = () => panel!.port!;
    const artifactPortOf = () => artifacts!.port!;
    const artifactOrigin = (requestHost: string) => `http://${sameHostOn(requestHost, artifactPortOf())}`;

    const envelope = (data: unknown, warnings: Warning[], error: {code: string; message: string; details?: unknown} | null, status = 200): Response => new Response(JSON.stringify({
        schema: PANEL_API_SCHEMA, ok: error === null, data, warnings, errors: error ? [error] : [], instance: state.instanceId, revisions: state.revisions(),
    }), {status, headers: {...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8"}});
    const notFound = () => envelope(null, [], {code: "not_found", message: "找不到"}, 404);

    const audit = createAuditWriter(auditPaths(options.env), state.instanceId);
    const locks = new PaneLocks();
    const controls = new ControlRegistry();
    const notifier = new Notifier({state, client: options.herdr, audit, locks, controls, log, onChange: () => state.notifyChanged()});
    const writes = createWriteHandler({state, envelope, log, audit, afterWrite: () => void notifier.tick()});
    const sessionIo = createSessionIo({state, notifier, locks, controls, audit, client: options.herdr, envelope, log});
    const terminalTools = resolveTerminalTools(options.env, options.herdr?.socketPath ?? null, (name) => Bun.which(name));
    if (!terminalTools.available) log(`网页终端不可用：${terminalTools.reason}`);
    const github = new GithubCache({cwd: context.mainRoot, env: options.env, hasClients: () => state.hasClients(), onChanged: () => state.githubChanged(), log});
    const checkoutStatuses = new CheckoutStatusCache();
    const terminals = new TerminalHub({state, client: options.herdr, tools: terminalTools, audit, notifier, locks, controls, log, timings: options.terminalTimings});
    // 记录、活动、会话变了就重算通知（通知自己的变化不再触发，免得打转；GitHub 的数据与通知无关）。
    const stopNotifyTrigger = state.onChange((part) => {
        if (part !== "notify" && part !== "github" && ready) void notifier.tick();
    });
    const serviceUnit = options.env.NBDEV_PANEL_UNIT && /^[A-Za-z0-9@._-]{1,128}$/u.test(options.env.NBDEV_PANEL_UNIT) ? options.env.NBDEV_PANEL_UNIT : null;

    /** 主工作区现在能不能写（不在 master、正在合并或变基时不能）：前端据此隐藏写入口，不必等每个请求回 409。 */
    async function mainWritability(): Promise<{ok: boolean; code: string | null; message: string | null}> {
        try {
            await assertMainWritable(context.mainRoot);
            return {ok: true, code: null, message: null};
        } catch (error) {
            if (!isNbdevError(error)) throw error;
            return {ok: false, code: error.code, message: error.message};
        }
    }

    const panelCsp = (requestHost: string) => [
        "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", `img-src 'self' data: ${artifactOrigin(requestHost)}`,
        `connect-src 'self' ws://${requestHost}`, `frame-src ${artifactOrigin(requestHost)}`, "frame-ancestors 'none'", "form-action 'none'", "base-uri 'none'", "object-src 'none'",
    ].join("; ");

    async function api(req: Request, segments: string[], url: URL, requestHost: string): Promise<Response> {
        const [, route, ...rest] = segments;
        try {
            if (route === "meta" && rest.length === 0) {
                const herdr = state.herdr.current();
                const mainWritable = await mainWritability();
                const parts = {records: state.records.part, activity: state.activity.part};
                const auditStatus = await readAuditStatus(audit.paths);
                return envelope({
                    instance: state.instanceId,
                    startedAt: state.startedAt,
                    ready,
                    codeChanged: state.codeChanged,
                    // 作为服务运行时（单元文件写了 NBDEV_PANEL_UNIT）提示里写重启命令；前台运行时为 null，提示“在终端重启”。
                    service: {unit: serviceUnit, restartCommand: serviceUnit ? `systemctl --user restart ${serviceUnit}` : null},
                    build: state.build,
                    herdr: {available: herdr.available, mode: herdr.mode, version: herdr.version, at: herdr.at, error: herdr.error, autoNotify: herdr.version !== null && AUTO_NOTIFY_VERSIONS.includes(herdr.version)},
                    audit: auditStatus.enabled ? {enabled: true, initAt: auditStatus.initAt, path: auditStatus.paths.file} : {enabled: false, reason: auditStatus.reason, detail: auditStatus.detail, path: auditStatus.paths.file},
                    notify: {pending: notifier.pendingCount(), attention: notifier.jobs.filter((job) => job.state === "replaced" || job.state === "no_target").length},
                    terminal: terminals.status(),
                    parts: Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, {revision: part.revision, at: part.at, error: part.error}])),
                    artifactOrigin: artifactOrigin(requestHost),
                    // 前端渲染 Markdown 时把 `.agents/works/` 下的图片与证据链接改写到产物来源上；前缀只经登录后的接口交出。
                    artifactBase: `${artifactOrigin(requestHost)}/a/${artifactPrefix}`,
                    mainWritable,
                }, [], null);
            }
            if (!ready) return envelope(null, [], {code: "warming_up", message: "面板正在启动"}, 503);
            if (route === "overview" && rest.length === 0) {
                const {data, warnings} = overviewView(state);
                return envelope(data, warnings, null);
            }
            if (route === "work" && rest.length === 1) {
                const view = await workView(state, rest[0]!);
                return view ? envelope(view.data, view.warnings, null) : notFound();
            }
            if (route === "task" && rest.length === 2) {
                const view = await taskView(state, rest[0]!, rest[1]!);
                return view ? envelope(view.data, view.warnings, null) : notFound();
            }
            if (route === "artifacts" && rest.length === 0) {
                const {data, warnings} = await artifactsView(state);
                return envelope(data, warnings, null);
            }
            if (route === "artifact" && rest.length === 3) {
                const base = (checkoutKey: string, path: string) => `${artifactOrigin(requestHost)}/a/${artifactPrefix}/${encodeURIComponent(checkoutKey)}/${path.split("/").map(encodeURIComponent).join("/")}`;
                const view = await artifactView(state, {workId: rest[0]!, taskId: rest[1] === "-" ? null : rest[1]!, artifactId: rest[2]!, version: url.searchParams.get("version")}, base);
                return view ? envelope(view.data, view.warnings, null) : notFound();
            }
            if (route === "docs" && rest.length === 1 && rest[0] === "tree") {
                const view = await docsTreeView(state, url.searchParams.get("checkout") ?? "main");
                return view ? envelope(view.data, view.warnings, null) : notFound();
            }
            if (route === "docs" && rest.length === 1 && rest[0] === "file") {
                const path = url.searchParams.get("path");
                if (path === null) return notFound();
                const view = await docFileView(state, url.searchParams.get("checkout") ?? "main", path);
                return view ? envelope(view.data, view.warnings, null) : notFound();
            }
            if (route === "docs" && rest.length === 1 && rest[0] === "diff") {
                const path = url.searchParams.get("path");
                if (path === null) return notFound();
                const view = await docDiffView(state, url.searchParams.get("checkout") ?? "main", path);
                return view ? envelope(view.data, view.warnings, null) : notFound();
            }
            if (route === "files" && rest.length === 0) {
                const path = url.searchParams.get("path");
                if (path === null) return notFound();
                const view = await fileView(state, path);
                return view ? envelope(view.data, view.warnings, null) : notFound();
            }
            if (route === "sessions" && rest.length === 0) {
                const {data, warnings} = sessionsView(state);
                return envelope(data, warnings, null);
            }
            if (route === "search" && rest.length === 0) return search(req, url);
            if (route === "runs" && rest.length === 0) {
                const {data, warnings} = runsView(state);
                return envelope(data, warnings, null);
            }
            if (route === "checkouts" && rest.length === 0) {
                const {data, warnings} = await checkoutsView(state, checkoutStatuses);
                return envelope(data, warnings, null);
            }
            if (route === "checkouts" && rest.length === 2 && rest[1] === "files") {
                const checkout = state.checkoutByKey(rest[0]!);
                if (!checkout || checkout.prunable) return notFound();
                return envelope({key: rest[0], ...await checkoutStatuses.files(checkout.root)}, [], null);
            }
            // 只读当前这一份，不触发取数：页面收到“github 变了”就重取这里（t14 实现审查 B1）。
            if (route === "github" && rest.length === 0) {
                const {data, warnings} = githubView(state, github.current());
                return envelope(data, warnings, null);
            }
            const handled = await sessionIo(req, segments, url);
            if (handled) return handled;
            return notFound();
        } catch (error) {
            if (error instanceof NotReady) return envelope(null, [], {code: "warming_up", message: error.message}, 503);
            if (isNbdevError(error)) return envelope(null, [], {code: error.code, message: error.message, details: error.details}, error.exitCode === 5 ? 404 : error.exitCode === 2 ? 400 : 500);
            log(`接口 ${url.pathname} 失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
            return envelope(null, [], {code: "internal", message: "面板内部错误，详见面板的日志"}, 500);
        }
    }

    /** 搜索：按行流式返回 NDJSON。全局同一时刻只跑一组，有新搜索或客户端断开就结束旧的子进程。 */
    function search(req: Request, url: URL): Response {
        let q: string;
        try {
            q = validateSearchQuery(url.searchParams.get("q") ?? "");
        } catch (error) {
            if (!isNbdevError(error)) throw error;
            return envelope(null, [], {code: error.code, message: error.message}, 400);
        }
        const key = url.searchParams.get("checkout");
        const targets = state.checkouts.filter((checkout) => !checkout.prunable && (key === null || state.keyOf(checkout.root) === key));
        if (key !== null && targets.length === 0) return notFound();
        currentSearch?.abort();
        const controller = new AbortController();
        currentSearch = controller;
        req.signal.addEventListener("abort", () => controller.abort(), {once: true});
        const started = Date.now();
        const encoder = new TextEncoder();
        let cancelled = false;
        const stream = new ReadableStream<Uint8Array>({
            async start(sink) {
                // 被新的搜索取代时照样送最后一行（`aborted: true`），客户端知道这组结果不全；客户端断开后就不再送。
                const send = (line: unknown) => {
                    if (!cancelled) sink.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
                };
                let truncated = false;
                try {
                    for (const match of recordMatches(state, q)) send({type: "record", ...match});
                    await searchCheckouts({
                        q,
                        checkouts: targets.map((checkout) => ({key: state.keyOf(checkout.root)!, root: checkout.root, head: checkout.head})),
                        names,
                        signal: controller.signal,
                        onHit: (hit) => send({type: "hit", ...hit}),
                        onCheckoutDone: (done) => {
                            truncated ||= done.truncated;
                            send({type: "checkout_done", ...done});
                        },
                    });
                    send({type: "end", truncated: truncated || controller.signal.aborted, aborted: controller.signal.aborted, elapsedMs: Date.now() - started});
                } catch (error) {
                    log(`搜索失败：${error instanceof Error ? error.message : String(error)}`);
                    send({type: "error", message: "搜索失败，详见面板的日志"});
                } finally {
                    if (currentSearch === controller) currentSearch = null;
                    if (!cancelled) sink.close();
                }
            },
            cancel() {
                cancelled = true;
                controller.abort();
            },
        });
        return new Response(stream, {headers: {...SECURITY_HEADERS, "Content-Type": "application/x-ndjson; charset=utf-8"}});
    }

    async function serveStatic(segments: string[], requestHost: string): Promise<Response> {
        if (!staticDir || !indexHtml) return plain(503, "面板正在启动，稍后刷新");
        const last = segments.at(-1) ?? "";
        // 单页路由回退只给不带点的路径：`/.git/config`、`/x.js` 这样的不会拿到 index.html。
        if (segments.length === 0 || !last.includes(".")) {
            if (segments.some((segment) => segment.startsWith("."))) return plain(404, "找不到");
            return new Response(indexHtml, {headers: {...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": panelCsp(requestHost)}});
        }
        const file = await guardedFile(staticDir, segments.join("/"));
        if (!file) return plain(404, "找不到");
        return new Response(Bun.file(file), {headers: {...SECURITY_HEADERS, "Content-Type": contentType(file), "Cache-Control": segments[0] === "assets" ? "public, max-age=31536000, immutable" : "no-store"}});
    }

    async function handlePanel(req: Request, server: Server<SocketData>): Promise<Response | undefined> {
        const forwarded = rejectForwarded(req.headers);
        if (forwarded) return rejection(forwarded);
        const badHost = rejectHost(req.headers, panelPort());
        if (badHost) return rejection(badHost);
        const requestHost = req.headers.get("host")!.toLowerCase();
        const url = new URL(req.url);
        const decoded = decodePath(url.pathname);
        if (isRejection(decoded)) return rejection(decoded);
        const {segments} = decoded;
        const origin = req.headers.get("origin");
        const sameOrigin = origin !== null && allowedHosts(panelPort()).some((allowed) => origin === `http://${allowed}`);
        const guarded = segments[0] === "api" || segments[0] === "ws";
        // 顺序：先跨站与登录，再核写请求的 Origin 与 CSRF。CSRF 令牌写在不要求登录的 index.html 里，本机任何账户都读得到，
        // 它只防浏览器里的跨站请求，不是本机账户之间的秘密；写请求必须先过登录。
        if (guarded) {
            const site = req.headers.get("sec-fetch-site");
            if (site !== null && site !== "same-origin" && site !== "none") return plain(403, "forbidden：跨站请求");
            if (!auth.authorized(req.headers.get("cookie"))) return segments[0] === "api" ? envelope(null, [], {code: "unauthorized", message: "没有登录：用 nbdev panel open 打开面板"}, 401) : plain(401, "unauthorized");
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
            if (!sameOrigin || !equalSecret(req.headers.get("x-nbdev-csrf"), csrf)) return plain(403, "forbidden：跨来源的写请求，或缺少 CSRF 令牌");
            if (segments[0] === "api" && req.method === "POST" && segments.length === 3 && segments[1] === "github" && segments[2] === "refresh") {
                // 只是让面板重取一次 GitHub 的只读数据，不经 gh 写任何东西。`ifStale`：页面打开时发，到了间隔才取、不等结果；
                // 不带是“刷新”按钮，立即取并等结果。
                let fields: Record<string, unknown>;
                try {
                    fields = await readFields(req, 1024, {ifStale: {type: "boolean"}});
                } catch (error) {
                    if (!isNbdevError(error)) throw error;
                    return envelope(null, [], {code: error.code, message: error.message, details: error.details}, statusOf(error));
                }
                if (fields.ifStale === true) github.touch();
                else await github.refresh();
                const {data, warnings} = githubView(state, github.current());
                return envelope(data, warnings, null);
            }
            if (segments[0] === "api") return (await sessionIo(req, segments, url)) ?? writes(req, segments, url);
            return plain(405, "method_not_allowed：这里没有写接口");
        }
        if (segments[0] === "login" && segments.length === 1) {
            const sessionId = auth.redeem(url.searchParams.get("ticket") ?? "");
            if (!sessionId) return plain(403, "登录链接无效或已过期：用 nbdev panel open 重新打开");
            return new Response(null, {status: 302, headers: {...SECURITY_HEADERS, "Set-Cookie": auth.cookie(sessionId), Location: "/"}});
        }
        if (guarded) {
            if (segments[0] === "ws") {
                if (!sameOrigin) return plain(403, "forbidden：WebSocket 的 Origin 不是本面板");
                if (segments.length === 1) return server.upgrade(req, {data: {kind: "panel", instance: state.instanceId}}) ? undefined : plain(400, "需要 WebSocket 升级");
                if (segments.length !== 2 || segments[1] !== "terminal") return plain(404, "找不到");
                // 升级前只做与 /ws 相同的安全校验；pane、terminal、上限在升级之后核，用关闭码告诉页面原因（浏览器拿不到升级失败的状态码）。
                const paneId = url.searchParams.get("pane") ?? "";
                const terminalId = url.searchParams.get("terminal") ?? "";
                if (!/^[A-Za-z0-9_.:-]{1,64}$/u.test(paneId) || !/^[A-Za-z0-9_][A-Za-z0-9_:.-]{0,127}$/u.test(terminalId)) return plain(400, "缺少 pane 或 terminal");
                const loginSession = auth.sessionOf(req.headers.get("cookie"))!;
                const data: TerminalSocketData = {kind: "terminal", instance: state.instanceId, connectionId: newConnectionId(), loginSession, paneId, terminalId};
                return server.upgrade(req, {data}) ? undefined : plain(400, "需要 WebSocket 升级");
            }
            return api(req, segments, url, requestHost);
        }
        return serveStatic(segments, requestHost);
    }

    async function handleArtifact(req: Request): Promise<Response> {
        const forwarded = rejectForwarded(req.headers);
        if (forwarded) return rejection(forwarded);
        const badHost = rejectHost(req.headers, artifactPortOf());
        if (badHost) return rejection(badHost);
        if (req.method !== "GET" && req.method !== "HEAD") return plain(405, "method_not_allowed：产物来源只读");
        const decoded = decodePath(new URL(req.url).pathname);
        if (isRejection(decoded)) return rejection(decoded);
        const [a, prefix, checkoutKey, ...rest] = decoded.segments;
        if (a !== "a" || !equalSecret(prefix ?? null, artifactPrefix) || checkoutKey === undefined || rest.length === 0) return plain(404, "找不到");
        const panelOrigins = allowedHosts(panelPort()).map((allowed) => `http://${allowed}`).join(" ");
        const headers = (type: string) => ({
            ...SECURITY_HEADERS,
            "Content-Type": type,
            // 地址里有猜不到的前缀，才能放开 CORS：沙箱 iframe 是不透明来源，模块脚本、fetch 与字体都按 CORS 取。
            "Access-Control-Allow-Origin": "*",
            "Content-Security-Policy": `sandbox allow-scripts allow-forms allow-popups; frame-ancestors ${panelOrigins}`,
        });
        if (checkoutKey === RESERVED_ARTIFACT_SEGMENT) {
            if (rest.length !== 1 || rest[0] !== ANSWER_BRIDGE_FILE) return plain(404, "找不到");
            return new Response(await answerBridgeScript(), {headers: headers("text/javascript; charset=utf-8")});
        }
        const checkout = state.checkoutByKey(checkoutKey);
        if (!checkout) return plain(404, "找不到");
        const file = await guardedFile(checkout.root, rest.join("/"), ".agents/works/");
        if (!file) return plain(404, "找不到");
        const type = contentType(file);
        // HTML 回应插上答题脚本的标签（t23），其余文件照旧直接回。长度按插过的内容算，HEAD 也一样。
        if (type.startsWith("text/html")) {
            return new Response(injectAnswerBridge(await Bun.file(file).text(), `/a/${artifactPrefix}/${RESERVED_ARTIFACT_SEGMENT}/${ANSWER_BRIDGE_FILE}`), {headers: headers(type)});
        }
        return new Response(Bun.file(file), {headers: headers(type)});
    }

    panel = listen(options.port, (port) => Bun.serve<SocketData>({
        hostname: host,
        port,
        // 写请求等锁最长 30 秒，持锁者还可能等 index.lock 10 秒。默认的 10 秒空闲超时会切断还在等回应的连接
        // （Bun 1.4.2 实测切的是没有请求体的请求，带 JSON 请求体的没切；不依赖这个细节）：浏览器看到失败，
        // 处理函数却照样写入，开发者再按一次就多领一个号。
        idleTimeout: 60,
        fetch: (req, server) => handlePanel(req, server),
        websocket: {
            // 断线（不发关闭帧）在 30 秒内发现：接管的连接靠它释放控制权（另有 15 秒的应用心跳）。
            idleTimeout: 30,
            open(ws) {
                if (ws.data.kind === "terminal") return terminals.open(ws as ServerWebSocket<TerminalSocketData>);
                sockets.add(ws);
                state.clientConnected();
                ws.send(JSON.stringify({type: "hello", instance: state.instanceId, revisions: state.revisions()}));
            },
            message(ws, message) {
                if (ws.data.kind === "terminal") terminals.message(ws as ServerWebSocket<TerminalSocketData>, message);
            },
            drain(ws) {
                if (ws.data.kind === "terminal") terminals.drain(ws as ServerWebSocket<TerminalSocketData>);
            },
            close(ws) {
                if (ws.data.kind === "terminal") return terminals.close(ws as ServerWebSocket<TerminalSocketData>);
                sockets.delete(ws);
                state.clientDisconnected();
            },
        },
    }));
    try {
        artifacts = listen(options.artifactPort, (port) => Bun.serve({hostname: host, port, fetch: (req) => handleArtifact(req)}));
    } catch (error) {
        await panel.stop(true);
        throw error;
    }
    const unsubscribe = state.onChange((part: PartName) => {
        const message = JSON.stringify({type: "changed", instance: state.instanceId, parts: [part], revisions: state.revisions()});
        for (const ws of sockets) ws.send(message);
    });

    const urlHost = host.includes(":") ? `[${host}]` : host;
    return {
        url: `http://${urlHost}:${panel.port}`,
        artifactUrl: `http://${urlHost}:${artifacts.port}`,
        port: panel.port!,
        artifactPort: artifacts.port!,
        instanceId: state.instanceId,
        state,
        auth,
        async setStatic(dir, build) {
            const html = await readFile(`${dir}/index.html`, "utf8");
            state.build = {failed: build.failed !== null, message: build.failed};
            indexHtml = html.replace("</head>", `<meta name="nbdev-csrf" content="${csrf}">\n</head>`);
            staticDir = dir;
        },
        async warm() {
            await state.warm();
            // 预热进行中收到退出信号时，收口已经做过：不再挂监视与定时器，否则进程收口后还活着。
            if (state.stopped) return false;
            state.watchAll();
            github.start();
            ready = true;
            notifier.start();
            for (const ws of sockets) ws.send(JSON.stringify({type: "changed", instance: state.instanceId, parts: ["records", "activity", "sessions"], revisions: state.revisions()}));
            return true;
        },
        async stop() {
            unsubscribe();
            stopNotifyTrigger();
            currentSearch?.abort();
            // 先释放网页终端的接管（改回尺寸、写释放行）、收掉终端流，再等进行中的投递结束（有上限），最后停监视：
            // 投递途中退出会留下只有意图的记录。
            await terminals.stop();
            github.stop();
            await notifier.stop();
            // `state.stop()` 同步停掉监视与定时器，返回的 Promise 等读标题的文件操作结束（有上限）：与关连接、关端口一起等。
            const stateStopped = state.stop();
            for (const ws of sockets) ws.close(1001, "面板退出");
            await Promise.all([panel?.stop(true), artifacts?.stop(true), stateStopped]);
        },
    };
}
