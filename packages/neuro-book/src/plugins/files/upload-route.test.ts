/**
 * 写入图片（docs/specs/workspace/files.md 的“写入图片”、验收场景 12）：路由是真实的（经真实分发：Host、Origin、准入），项目跑在
 * 真实子进程里，写入走服务端的 `projects://` 与项目实例的提交链；判据是磁盘上的结果与项目的变更事件。取消与分块传输另经真实的
 * `Bun.serve` 与真实的 HTTP 连接。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {chmod, mkdir, readdir, readFile, rm, stat, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {HTTP_ROUTES_POINT} from "@notnotype/nb-host/http/contracts";
import {createDispatcher, HttpAdmission, RouteTable, validateRouteContribution} from "@notnotype/nb-host/testing";
import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {Hono} from "hono";

import {definitionAt} from "nbook/manifest";
import {GRACE_MS, killSpawnedProjects, leaseOf, projectHarness, revoked} from "nbook/server/testing/projects";

import {filesBackendPlugin} from "./backend/plugin";
import {CONCURRENT_UPLOADS, Gate} from "./backend/upload-route";
import {descriptor} from "./plugin";
import {projectFilesContract} from "./shared/contracts";
import type {ChangesMessage} from "./shared/contracts";
import {UPLOAD_MAX_BYTES} from "./shared/upload";
import {createFilesClient} from "./web/client";
import type {Fetcher} from "./web/client";

let tmp = "";
const harnesses: Array<{stop(): Promise<void>}> = [];
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "upload-route");
});
afterEach(async () => {
    try {
        for (const harness of harnesses.splice(0)) await harness.stop();
    } finally {
        killSpawnedProjects();
    }
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const silent = {log: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined};
const bytes = (...values: number[]) => new Uint8Array(values);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4);
const PNG_2 = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 5, 6);
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 7);
const ORIGIN = "http://127.0.0.1:4217";
const encodePath = (path: string): string => path.split("/").map((segment) => encodeURIComponent(segment)).join("/");

/** 一个超过上限的 PNG：文件头对、后面全是零。 */
const oversized = (): Uint8Array => {
    const body = new Uint8Array(UPLOAD_MAX_BYTES + 1);
    body.set(PNG);
    return body;
};

interface Probe {
    remote: ActivationContext["remote"] | null;
}

async function scene() {
    const routes = new RouteTable();
    const probe: Probe = {remote: null};
    const h = await projectHarness(tmp, {plugins: [
        createDiagnosticsPlugin({location: "server", store: createDiagnosticsStore({identity: {location: "server", instanceId: "test"}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)}),
        {id: "nbook.http", contributionPoints: [{id: HTTP_ROUTES_POINT, implementation: "required", validate: validateRouteContribution}], entries: [defineEntry({id: "server", location: "server", activationEvents: ["onStartup"], receives: [HTTP_ROUTES_POINT], activate: () => ({receivers: {[HTTP_ROUTES_POINT]: routes.receiver()}})})]},
        definitionAt("server", descriptor, filesBackendPlugin),
        // 订阅项目变更用：只要远程入口。
        {id: "x.probe", entries: [defineEntry({id: "server", location: "server", activationEvents: ["onStartup"], activate: (context) => {
            probe.remote = context.remote;
            return {};
        }})]},
    ]});
    const admission = new HttpAdmission({productName: "NeuroBook"});
    admission.ready();
    // 路由只服务正在运行的那一代：用一份租约让项目开着。
    const lease = leaseOf(await h.manager.acquire(h.project.id, "upload-test"));
    harnesses.push({stop: async () => {
        lease.release();
        await admission.drain();
        expect(await h.parent.stop()).toMatchObject({status: "closed"});
    }});
    const allowed = new Set([ORIGIN]);
    const dispatch = createDispatcher({admission, routes, hostRoutes: new Hono(), staticFiles: null, reportError: () => undefined, allowOrigin: (origin: string) => allowed.has(origin)});
    const book = join(h.root, "Book");
    /** 响应体读完准入才算请求结束，否则停止时的排空一直等：这里先读完。 */
    const put = async (path: string, body: Uint8Array | string | ReadableStream<Uint8Array>, init: {readonly query?: string; readonly headers?: Record<string, string>; readonly id?: string; readonly generation?: number; readonly noOrigin?: boolean} = {}): Promise<Response> => {
        const url = `http://127.0.0.1:4217/api/nbook.files/raw/project/${init.id ?? h.project.id}/${String(init.generation ?? lease.generation)}/${encodePath(path)}${init.query ?? ""}`;
        const response = await dispatch(new Request(url, {method: "PUT", body, headers: init.noOrigin === true ? init.headers : {origin: ORIGIN, ...init.headers}, ...(body instanceof ReadableStream ? {duplex: "half"} : {})} as RequestInit));
        return new Response(await response.arrayBuffer(), {status: response.status, headers: response.headers});
    };
    const staged = async (): Promise<string[]> => readdir(join(book, ".nbook", "staging")).catch(() => []);
    return {h, book, put, dispatch, probe, lease, staged, allowed};
}

const code = async (response: Response): Promise<string> => ((await response.json()) as {error: {code: string}}).error.code;
const read = (book: string, path: string): Promise<Uint8Array> => readFile(join(book, path)).then((buffer) => new Uint8Array(buffer));

describe("写入图片（Spec 验收场景 12）", () => {
    it("写进还没有的目录：201，目录与文件都在、字节相同；响应里是 project:// 地址", async () => {
        const {book, put} = await scene();
        const response = await put("插图/a.png", PNG);
        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({address: "project://插图/a.png", renamed: false});
        expect(await read(book, "插图/a.png")).toEqual(PNG);
        // 文件名与目录名里的空格、中文按 URL 编码传，原样落盘。
        expect((await put("图 集/b c.png", PNG)).status).toBe(201);
        expect(await read(book, "图 集/b c.png")).toEqual(PNG);
    });

    it("项目的变更事件：新文件与新建出来的父目录都收到 created，来源是系统（HTTP 端口没有窗口身份）", async () => {
        const {h, put, probe} = await scene();
        const messages: ChangesMessage[] = [];
        const subscribed = await probe.remote!.use(projectFilesContract).at({project: h.project.id}).events.changes.subscribe({}, (message) => messages.push(message));
        expect(subscribed.ok).toBe(true);
        await waitUntil("订阅就绪", () => messages.some((message) => message.kind === "ready"));
        expect((await put("插图/a.png", PNG)).status).toBe(201);
        const events = () => messages.flatMap((message) => (message.kind === "batch" ? message.events : []));
        await waitUntil("文件与目录的 created", () => events().some((event) => event.path === "插图/a.png") && events().some((event) => event.path === "插图"));
        for (const path of ["插图", "插图/a.png"]) expect(events().find((event) => event.path === path)).toMatchObject({type: "created", source: {kind: "system", plugin: "nbook.files"}});
    });

    it("不覆盖：默认 409 conflict、原文件字节不变；rename 依次是 名字 2、名字 3，renamed 为真", async () => {
        const {book, put, staged} = await scene();
        expect((await put("插图/a.png", PNG)).status).toBe(201);
        const clash = await put("插图/a.png", PNG_2);
        expect(clash.status).toBe(409);
        expect(await code(clash)).toBe("conflict");
        expect(await read(book, "插图/a.png")).toEqual(PNG);
        for (const [n, body] of [[2, PNG_2], [3, PNG]] as const) {
            const renamed = await put("插图/a.png", body, {query: "?exists=rename"});
            expect(renamed.status).toBe(201);
            expect(await renamed.json()).toEqual({address: `project://插图/a ${String(n)}.png`, renamed: true});
            expect(await read(book, `插图/a ${String(n)}.png`)).toEqual(body);
        }
        // 名字里已有的序号不认：`a 2.png` 再写是 `a 2 2.png`。
        expect(await (await put("插图/a 2.png", PNG, {query: "?exists=rename"})).json()).toEqual({address: "project://插图/a 2 2.png", renamed: true});
        // 没有重名时 rename 照原名写，renamed 为假。
        expect(await (await put("插图/新.png", PNG, {query: "?exists=rename"})).json()).toEqual({address: "project://插图/新.png", renamed: false});
        expect(await staged()).toEqual([]);
    });

    it("目标是同名的目录或链接（含指向不存在目标的链接）：fail 为 409、原样不动；rename 把它们都当作被占用，取下一个空名", async () => {
        const {book, put} = await scene();
        await mkdir(join(book, "图", "d.png"), {recursive: true});
        await writeFile(join(book, "图", "real.png"), PNG);
        await symlink("real.png", join(book, "图", "l.png"));
        await symlink("missing.png", join(book, "图", "dangling.png"));
        for (const name of ["d.png", "l.png", "dangling.png"]) {
            const response = await put(`图/${name}`, PNG_2);
            expect([response.status, await code(response)]).toEqual([409, "conflict"]);
        }
        expect(await read(book, "图/real.png")).toEqual(PNG);
        expect((await put("图/d.png", PNG_2, {query: "?exists=rename"})).status).toBe(201);
        expect(await read(book, "图/d 2.png")).toEqual(PNG_2);
        expect((await put("图/l.png", PNG_2, {query: "?exists=rename"})).status).toBe(201);
        expect(await read(book, "图/l 2.png")).toEqual(PNG_2);
        expect((await put("图/dangling.png", PNG_2, {query: "?exists=rename"})).status).toBe(201);
        expect(await read(book, "图/dangling 2.png")).toEqual(PNG_2);
        // 悬空链接没有被写穿：它指向的 missing.png 没有被建出来。
        expect(await readdir(join(book, "图"))).not.toContain("missing.png");
    });

    it("同一时刻两个请求写同一个名字：fail 时恰好一个 201、另一个 409；rename 时各得到不同的地址、两个文件都在", async () => {
        const {book, put} = await scene();
        const raced = await Promise.all([put("插图/x.png", PNG), put("插图/x.png", PNG_2)]);
        expect(raced.map((response) => response.status).sort()).toEqual([201, 409]);
        const both = await Promise.all([put("插图/y.png", PNG, {query: "?exists=rename"}), put("插图/y.png", PNG_2, {query: "?exists=rename"})]);
        expect(both.map((response) => response.status)).toEqual([201, 201]);
        const addresses = (await Promise.all(both.map((response) => response.json()))).map((body) => (body as {address: string}).address);
        expect(new Set(addresses).size).toBe(2);
        expect((await readdir(join(book, "插图"))).sort()).toEqual(["x.png", "y 2.png", "y.png"]);
    });

    it("类型按文件头判定：四种图片都收；扩展名不分大小写、JPEG 是 .jpg 或 .jpeg；对不上为 415 extension-mismatch，不是图片或扩展名不在集合里为 415 unsupported-type", async () => {
        const {book, put} = await scene();
        for (const [name, body] of [["a.png", PNG], ["b.JPG", JPEG], ["c.jpeg", JPEG], ["d.gif", GIF], ["e.WebP", WEBP]] as const) expect((await put(`图/${name}`, body)).status).toBe(201);
        expect((await readdir(join(book, "图"))).sort()).toEqual(["a.png", "b.JPG", "c.jpeg", "d.gif", "e.WebP"]);
        const refused: Array<[string, Uint8Array | string, number, string]> = [
            ["x.png", JPEG, 415, "extension-mismatch"],
            ["x.jpg", PNG, 415, "extension-mismatch"],
            ["x.png", "hello", 415, "unsupported-type"],
            ["x.png", new Uint8Array(), 415, "unsupported-type"],
            ["x.svg", PNG, 415, "unsupported-type"],
            ["x.txt", PNG, 415, "unsupported-type"],
            ["x", PNG, 415, "unsupported-type"],
            ["x.jfif", JPEG, 415, "unsupported-type"],
            [".png", PNG, 400, "invalid-address"],
        ];
        for (const [name, body, status, expected] of refused) {
            const response = await put(`图/${name}`, body);
            expect([name, response.status, await code(response)]).toEqual([name, status, expected]);
        }
        expect((await readdir(join(book, "图"))).length).toBe(5);
    });

    it("33 MiB：413 too-large、磁盘上没有文件、没有残留的暂存；分块传输（没有 Content-Length）同样", async () => {
        const {book, put, staged} = await scene();
        const big = oversized();
        const sized = await put("插图/big.png", big);
        expect([sized.status, await code(sized)]).toEqual([413, "too-large"]);
        const chunked = new ReadableStream<Uint8Array>({
            start(controller) {
                for (let offset = 0; offset < big.byteLength; offset += 1024 * 1024) controller.enqueue(big.subarray(offset, Math.min(offset + 1024 * 1024, big.byteLength)));
                controller.close();
            },
        });
        const response = await put("插图/big.png", chunked);
        expect([response.status, await code(response)]).toEqual([413, "too-large"]);
        expect(await readdir(join(book, "插图")).catch(() => [])).toEqual([]);
        expect(await staged()).toEqual([]);
        // 刚好 32 MiB 收。
        const exact = new Uint8Array(UPLOAD_MAX_BYTES);
        exact.set(PNG);
        expect((await put("插图/exact.png", exact)).status).toBe(201);
    });

    it("路径与项目：控制目录 404 protected-path；父路径的某段是文件 409 not-a-directory；代次不符、没有这部作品为 410 generation-gone；链接到根外 404", async () => {
        const {h, book, put} = await scene();
        const hidden = await put(".nbook/a.png", PNG);
        expect([hidden.status, await code(hidden)]).toEqual([404, "protected-path"]);
        const upper = await put(".NBOOK/a.png", PNG);
        expect([upper.status, await code(upper)]).toEqual([404, "protected-path"]);
        await writeFile(join(book, "插图"), "我是文件");
        const blocked = await put("插图/a.png", PNG);
        expect([blocked.status, await code(blocked)]).toEqual([409, "not-a-directory"]);
        const wrong = await put("图/a.png", PNG, {generation: 99});
        expect([wrong.status, await code(wrong)]).toEqual([410, "generation-gone"]);
        const nobody = await put("图/a.png", PNG, {id: "00000000-0000-4000-8000-000000000000"});
        expect([nobody.status, await code(nobody)]).toEqual([410, "generation-gone"]);
        await mkdir(join(h.root, "outside"), {recursive: true});
        await symlink(join(h.root, "outside"), join(book, "外链"));
        const escaped = await put("外链/a.png", PNG);
        expect([escaped.status, await code(escaped)]).toEqual([404, "outside-root"]);
        expect(await readdir(join(h.root, "outside"))).toEqual([]);
        // 空段：`..` 在 URL 里会被请求自己折叠掉，路由看不到，由文件服务的地址规则拒绝的是空段。
        expect((await put("图//a.png", PNG)).status).toBe(400);
    });

    it("来源：Sec-Fetch-Site 带了且不是 same-origin（same-site、cross-site、none）为 403 cross-site；不带、same-origin 照常；Origin 不在允许的来源为 403", async () => {
        const {book, put} = await scene();
        for (const site of ["same-site", "cross-site", "none"]) {
            const response = await put("插图/s.png", PNG, {headers: {"sec-fetch-site": site}});
            expect([site, response.status, await code(response)]).toEqual([site, 403, "cross-site"]);
        }
        expect((await put("插图/s.png", PNG, {headers: {"sec-fetch-site": "same-origin"}})).status).toBe(201);
        expect((await put("插图/t.png", PNG)).status).toBe(201);
        const foreign = await put("插图/u.png", PNG, {headers: {origin: "http://evil.example"}});
        expect(foreign.status).toBe(403);
        // 空的 Origin 头不是“没带”：分发层一律拒绝；真正没带（本机进程）才放行。
        expect((await put("插图/v.png", PNG, {headers: {origin: ""}})).status).toBe(403);
        expect((await put("插图/w.png", PNG, {noOrigin: true})).status).toBe(201);
        expect((await readdir(join(book, "插图"))).sort()).toEqual(["s.png", "t.png", "w.png"]);
    });

    it("名字：超过 255 字节两种模式都是 400 invalid-address；rename 加了序号才超长另有说明；扩展名查表不读原型链上的东西", async () => {
        const {book, put} = await scene();
        const long = `${"长".repeat(90)}.png`;
        for (const query of ["", "?exists=rename"]) {
            const response = await put(`图/${long}`, PNG, {query});
            expect([query, response.status, await code(response)]).toEqual([query, 400, "invalid-address"]);
        }
        // 原名刚好 255 字节：能写；已有同名时加了序号就超了，说明里写“加了序号”。
        const exact = `${"长".repeat(83)}ab.png`;
        expect(new TextEncoder().encode(exact).byteLength).toBe(255);
        expect((await put(`图/${exact}`, PNG)).status).toBe(201);
        const grown = await put(`图/${exact}`, PNG_2, {query: "?exists=rename"});
        expect([grown.status, await code(grown)]).toEqual([400, "invalid-address"]);
        for (const name of ["a.constructor", "a.__proto__"]) {
            const response = await put(`图/${name}`, PNG);
            expect([name, response.status, await code(response)]).toEqual([name, 415, "unsupported-type"]);
        }
        expect(await readdir(join(book, "图"))).toEqual([exact]);
    });

    it("作品根：rename 在根下也挑得出名字，同名的悬空链接算被占用", async () => {
        const {book, put} = await scene();
        await writeFile(join(book, "a.png"), PNG);
        await symlink("missing.png", join(book, "dangling.png"));
        const first = await put("a.png", PNG_2, {query: "?exists=rename"});
        expect([first.status, await first.json()]).toEqual([201, {address: "project://a 2.png", renamed: true}]);
        const dangling = await put("dangling.png", PNG_2, {query: "?exists=rename"});
        expect([dangling.status, await dangling.json()]).toEqual([201, {address: "project://dangling 2.png", renamed: true}]);
        expect(await readdir(book)).not.toContain("missing.png");
    });

    it("rename 只把完全同名的当作被占用；大小写不敏感的文件系统上 `A.png` 与 `a.png` 是同一个，靠写入时的冲突重试换名", async () => {
        const {book, put} = await scene();
        await mkdir(join(book, "图"), {recursive: true});
        await writeFile(join(book, "图", "A.png"), PNG);
        const insensitive = await stat(join(book, "图", "a.png")).then(() => true, () => false);
        const response = await put("图/a.png", PNG_2, {query: "?exists=rename"});
        expect([response.status, await response.json()]).toEqual([201, {address: insensitive ? "project://图/a 2.png" : "project://图/a.png", renamed: insensitive}]);
    });

    it("路径中间是指向不存在目标的链接：404 not-found，不当成“目标被占用”；rename 同样", async () => {
        const {book, put} = await scene();
        await symlink("missing-dir", join(book, "悬空目录"));
        for (const query of ["", "?exists=rename"]) {
            const response = await put("悬空目录/a.png", PNG, {query});
            expect([query, response.status, await code(response)]).toEqual([query, 404, "not-found"]);
        }
    });

    it.skipIf(process.getuid?.() === 0)("父目录只读又要现建子目录：403 permission-denied（root 不受权限位约束，不在此测）", async () => {
        const {book, put} = await scene();
        await mkdir(join(book, "只读"), {recursive: true});
        await chmod(join(book, "只读"), 0o555);
        try {
            const response = await put("只读/新/a.png", PNG);
            expect([response.status, await code(response)]).toEqual([403, "permission-denied"]);
        } finally {
            await chmod(join(book, "只读"), 0o755);
        }
    });

    it("作品开始停止接纳之后：取不到租约，503 project-unavailable，不写", async () => {
        const {h, book, put} = await scene();
        h.manager.stopAdmission();
        const response = await put("插图/a.png", PNG);
        expect([response.status, await code(response)]).toEqual([503, "project-unavailable"]);
        expect(await readdir(book).then((names) => names.includes("插图"))).toBe(false);
    });
});

describe("真实的 HTTP 连接（Bun.serve）", () => {
    /** 把分发器挂到真实的端口上：分块传输、连接中断都经真实的套接字。 */
    async function listening() {
        const s = await scene();
        /**
         * 路由开始读请求体的时刻：包一层只在被读时才拉取的流（`highWaterMark: 0`）。路由先取租约、再读请求体，
         * 所以“已经在读”说明租约已经取到。
         */
        let reading = false;
        const server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: (request) => {
            const source = request.body?.getReader();
            if (source === undefined) return s.dispatch(request);
            const watched = new ReadableStream<Uint8Array>({
                async pull(controller) {
                    reading = true;
                    const next = await source.read();
                    if (next.done) controller.close();
                    else controller.enqueue(next.value);
                },
                cancel: (reason) => source.cancel(reason),
            }, {highWaterMark: 0});
            return s.dispatch(new Request(request.url, {method: request.method, headers: request.headers, body: watched, duplex: "half"} as RequestInit));
        }});
        s.allowed.add(`http://127.0.0.1:${String(server.port)}`);
        const base = `http://127.0.0.1:${String(server.port)}/api/nbook.files/raw/project/${s.h.project.id}/${String(s.lease.generation)}`;
        harnesses.push({stop: async () => {
            await server.stop(true);
        }});
        return {...s, base, isReading: () => reading};
    }

    /** 先发出文件头、后面的字节等 `release` 才发：上传停在“正在读请求体”。 */
    function held() {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        let step = 0;
        const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
                if (step === 0) {
                    step = 1;
                    controller.enqueue(PNG);
                    return;
                }
                await gate;
                controller.enqueue(bytes(1, 2, 3));
                controller.close();
            },
        });
        return {body, release};
    }

    it("上传途中宽限期满：路由持有租约，项目不停、写在同一代，不会为这次上传启动新的一代", async () => {
        const {h, book, base, lease, isReading} = await listening();
        const {body, release} = held();
        const pending = fetch(`${base}/${encodePath("插图/late.png")}`, {method: "PUT", body, duplex: "half"} as RequestInit);
        await waitUntil("路由开始读请求体", isReading);
        // 路由在读请求体时手里有一份租约：放掉测试自己的那份、宽限期走完，项目仍在这一代。
        lease.release();
        h.clock.advance(GRACE_MS);
        expect(h.manager.running(h.project.id)).toEqual({generation: lease.generation, state: "running"});
        release();
        const response = await pending;
        expect([response.status, await response.json()]).toEqual([201, {address: "project://插图/late.png", renamed: false}]);
        expect((await read(book, "插图/late.png")).byteLength).toBe(PNG.byteLength + 3);
        expect(h.manager.running(h.project.id)?.generation).toBe(lease.generation);
    });

    it("上传途中这一代被收回（项目子进程崩溃）：410 generation-gone，不启动新的一代，没有文件", async () => {
        const {h, book, base, lease, isReading, staged} = await listening();
        const {body, release} = held();
        const pending = fetch(`${base}/${encodePath("插图/late.png")}`, {method: "PUT", body, duplex: "half"} as RequestInit);
        await waitUntil("路由开始读请求体", isReading);
        const listed = await h.manager.list();
        const pid = listed.ok ? listed.value.find((item) => item.id === h.project.id)?.pid ?? null : null;
        if (pid === null) throw new Error("项目没有在运行");
        process.kill(pid, "SIGKILL");
        await revoked(lease);
        release();
        const response = await pending;
        expect([response.status, ((await response.json()) as {error: {code: string}}).error.code]).toEqual([410, "generation-gone"]);
        expect(h.manager.running(h.project.id)).toBeNull();
        expect(await readdir(book).then((names) => names.includes("插图"))).toBe(false);
        expect(await staged()).toEqual([]);
    });

    it("分块传输的 33 MiB：413，磁盘上没有文件；之后同一个连接池里的正常上传不受影响", async () => {
        const {book, base} = await listening();
        const big = oversized();
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                for (let offset = 0; offset < big.byteLength; offset += 1024 * 1024) controller.enqueue(big.subarray(offset, Math.min(offset + 1024 * 1024, big.byteLength)));
                controller.close();
            },
        });
        const response = await fetch(`${base}/${encodePath("插图/big.png")}`, {method: "PUT", body, duplex: "half"} as RequestInit);
        expect(response.status).toBe(413);
        await response.arrayBuffer();
        expect(await readdir(join(book, "插图")).catch(() => [])).toEqual([]);
        const ok = await fetch(`${base}/${encodePath("插图/ok.png")}`, {method: "PUT", body: PNG});
        expect(ok.status).toBe(201);
        await ok.arrayBuffer();
        expect(await read(book, "插图/ok.png")).toEqual(PNG);
    });

    it("请求体发完之前取消（连接中断）：磁盘上没有文件、没有残留的暂存", async () => {
        const {book, base, staged} = await listening();
        const abort = new AbortController();
        let sent = 0;
        // 只发一半就不再发、也不结束：服务端的读一直在等，取消后它必须放弃、不写。
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (sent === 0) {
                    sent += 1;
                    controller.enqueue(PNG);
                    return;
                }
                return new Promise<void>(() => undefined);
            },
        });
        const pending = fetch(`${base}/${encodePath("插图/half.png")}`, {method: "PUT", body, duplex: "half", signal: abort.signal} as RequestInit).catch((error: unknown) => error);
        await waitUntil("第一块已发出", () => sent > 0);
        abort.abort();
        expect(await pending).toBeInstanceOf(Error);
        // 服务端看到连接断开后路由收尾；之后一次正常上传能成功，说明队列没有被卡住，磁盘上也只有这一张。
        const ok = await fetch(`${base}/${encodePath("插图/ok.png")}`, {method: "PUT", body: PNG});
        expect(ok.status).toBe(201);
        await ok.arrayBuffer();
        expect(await readdir(join(book, "插图"))).toEqual(["ok.png"]);
        expect(await staged()).toEqual([]);
    });
});

describe("浏览器客户端的 upload（经真实的 HTTP 连到真实的路由）", () => {
    /** 客户端的请求是同源的相对地址：测试里补上真实服务的地址、带上同源的头。 */
    async function client() {
        const s = await scene();
        const server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: (request) => s.dispatch(request)});
        const origin = `http://127.0.0.1:${String(server.port)}`;
        s.allowed.add(origin);
        harnesses.push({stop: async () => {
            await server.stop(true);
        }});
        const requests: string[] = [];
        const fetcher: Fetcher = (url, init) => {
            requests.push(url);
            return fetch(`${origin}${url}`, {...init, headers: {origin, "sec-fetch-site": "same-origin"}});
        };
        const bound = createFilesClient({} as never, {} as never, {} as never, {id: s.h.project.id, generation: s.lease.generation}, fetcher).service;
        const unbound = createFilesClient({} as never, {} as never, {} as never, null, fetcher).service;
        return {...s, bound, unbound, requests};
    }

    it("成功：返回写下的地址；已存在默认 conflict，rename 给 名字 2 并带 renamed；错误码取自响应体", async () => {
        const {book, bound} = await client();
        expect(await bound.upload("project://插图/a.png", new Blob([PNG]))).toEqual({ok: true, address: "project://插图/a.png", renamed: false});
        expect(await read(book, "插图/a.png")).toEqual(PNG);
        expect(await bound.upload("project://插图/a.png", PNG_2)).toMatchObject({ok: false, code: "conflict"});
        expect(await bound.upload("project://插图/a.png", PNG_2, {exists: "rename"})).toEqual({ok: true, address: "project://插图/a 2.png", renamed: true});
        expect(await bound.upload("project://插图/b.png", JPEG)).toMatchObject({ok: false, code: "extension-mismatch"});
        expect(await bound.upload("project://.nbook/b.png", PNG)).toMatchObject({ok: false, code: "protected-path"});
    });

    it("不发出请求：没有绑定作品、不是 project://、地址不合法为 unavailable；超过 32 MiB 在客户端就 too-large", async () => {
        const {book, bound, unbound, requests} = await client();
        expect(await unbound.upload("project://插图/a.png", PNG)).toMatchObject({ok: false, code: "unavailable"});
        expect(await bound.upload("user://插图/a.png", PNG)).toMatchObject({ok: false, code: "unavailable"});
        expect(await bound.upload("不是地址", PNG)).toMatchObject({ok: false, code: "unavailable"});
        expect(await bound.upload("project://插图/big.png", new Uint8Array(UPLOAD_MAX_BYTES + 1))).toMatchObject({ok: false, code: "too-large"});
        // 这几次都没有发出请求，不是发出去被服务端拒绝。
        expect(requests).toEqual([]);
        expect(await readdir(book).then((names) => names.includes("插图"))).toBe(false);
    });

    it("调用方取消：cancelled，不当成一定没写；服务连不上：network", async () => {
        const {bound} = await client();
        const abort = new AbortController();
        abort.abort();
        expect(await bound.upload("project://插图/a.png", PNG, {signal: abort.signal})).toMatchObject({ok: false, code: "cancelled"});
        const dead = createFilesClient({} as never, {} as never, {} as never, {id: "x", generation: 1}, () => Promise.reject(new TypeError("Failed to fetch"))).service;
        expect(await dead.upload("project://插图/a.png", PNG)).toMatchObject({ok: false, code: "network"});
    });

    it("响应体不认得时按状态码兜底（不靠码表的书写顺序），不是 JSON 也不抛出", async () => {
        const odd = (status: number): Fetcher => () => Promise.resolve(new Response("<html>bad gateway</html>", {status}));
        const expected = [[400, "invalid-address"], [403, "cross-site"], [404, "not-found"], [409, "conflict"], [410, "generation-gone"], [413, "too-large"], [415, "unsupported-type"], [418, "io-failed"], [500, "io-failed"], [502, "unknown-outcome"], [503, "project-unavailable"]] as const;
        for (const [status, code] of expected) {
            const service = createFilesClient({} as never, {} as never, {} as never, {id: "x", generation: 1}, odd(status)).service;
            expect([status, await service.upload("project://插图/a.png", PNG)]).toEqual([status, expect.objectContaining({ok: false, code})]);
        }
    });

    it("2xx 而响应体读不到或不认得：图已经写下，不报成别的写入失败（读体时被取消是 cancelled、断开是 network，体不认得是 unknown-outcome）", async () => {
        const broken = (): Fetcher => () => Promise.resolve(new Response(new ReadableStream<Uint8Array>({start: (controller) => controller.error(new TypeError("连接断了"))}), {status: 201}));
        const service = (fetcher: Fetcher) => createFilesClient({} as never, {} as never, {} as never, {id: "x", generation: 1}, fetcher).service;
        expect(await service(broken()).upload("project://插图/a.png", PNG)).toMatchObject({ok: false, code: "network"});
        const abort = new AbortController();
        const cancelled: Fetcher = () => {
            abort.abort();
            return broken()("", {});
        };
        expect(await service(cancelled).upload("project://插图/a.png", PNG, {signal: abort.signal})).toMatchObject({ok: false, code: "cancelled"});
        const strange: Fetcher = () => Promise.resolve(new Response('{"ok":true}', {status: 201}));
        expect(await service(strange).upload("project://插图/a.png", PNG)).toMatchObject({ok: false, code: "unknown-outcome"});
    });
});

describe("排队：同时至多处理 2 个上传", () => {
    it("5 个任务、上限 2：任一时刻在跑的不超过 2 个，全部完成，失败的任务不堵住后面的", async () => {
        const gate = new Gate(CONCURRENT_UPLOADS);
        expect(CONCURRENT_UPLOADS).toBe(2);
        let active = 0;
        let peak = 0;
        const finished: number[] = [];
        const tasks = [0, 1, 2, 3, 4].map((n) => gate.run(async () => {
            active += 1;
            peak = Math.max(peak, active);
            await Promise.resolve();
            await Promise.resolve();
            active -= 1;
            finished.push(n);
            if (n === 1) throw new Error("任务自己的失败");
            return n;
        }));
        const settled = await Promise.allSettled(tasks);
        expect(peak).toBe(2);
        expect(finished.sort()).toEqual([0, 1, 2, 3, 4]);
        expect(settled.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled", "fulfilled", "fulfilled"]);
    });
});
