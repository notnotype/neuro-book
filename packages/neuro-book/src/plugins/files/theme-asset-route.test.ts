/**
 * 写主题场景素材（docs/specs/theme/editor.md 的“写场景素材”）：路由接真实的文件服务，提交走真实的暂存与记账，判据是磁盘上的结果。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {createHash} from "node:crypto";
import {chmod, mkdir, readdir, readFile, rm, stat, symlink, utimes, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {Hono} from "hono";

import {definitionAt} from "nbook/manifest";
import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {killSpawnedProjects, projectHarness} from "nbook/server/testing/projects";
import {HttpAdmission} from "nbook/plugins/http/backend/admission";
import {createDispatcher, RouteTable, validateRouteContribution} from "nbook/plugins/http/backend/dispatch";
import {HTTP_ROUTES_POINT} from "nbook/plugins/http/shared/contracts";

import {filesBackendPlugin} from "./backend/plugin";
import {descriptor} from "./plugin";
import {THEME_ASSET_MAX_BYTES, THEME_ASSET_SWEEP_MAX_BYTES, THEME_ASSET_SWEEP_MAX_NAMES, THEME_ICON_MAX_BYTES} from "./shared/contracts";
import type {BatchResult, ThemeAssetSweepResult, ThemeAssetSweepStats} from "./shared/contracts";
import type {ServerFilesResult} from "./shared/workspace-files";
import type {HttpRouteEnv} from "nbook/plugins/http/shared/contracts";
import {addThemeAssetRoutes} from "./backend/theme-asset-route";
import {ThemeAssetGuard} from "./backend/theme-asset-common";
import {LEDGER_POINT} from "./shared/ledger";
import type {LedgerEntry} from "./shared/ledger";

let tmp = "";
const harnesses: Array<{stop(): Promise<void>}> = [];
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "theme-asset-route");
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
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 7]);
const ICON = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 4h16v16H4z"/></svg>');
const ORIGIN = "http://127.0.0.1:4217";
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** 走真实的贡献：路由由 nbook.files 贡献、经真实分发（Host、Origin、准入），写入归属与记账才是产品里的样子。 */
async function scene() {
    const routes = new RouteTable();
    const ledger: LedgerEntry[] = [];
    const h = await projectHarness(tmp, {plugins: [
        createDiagnosticsPlugin({location: "server", store: createDiagnosticsStore({identity: {location: "server", instanceId: "test"}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)}),
        {id: "nbook.http", contributionPoints: [{id: HTTP_ROUTES_POINT, implementation: "required", validate: validateRouteContribution}], entries: [defineEntry({id: "server", location: "server", activationEvents: ["onStartup"], receives: [HTTP_ROUTES_POINT], activate: () => ({receivers: {[HTTP_ROUTES_POINT]: routes.receiver()}})})]},
        definitionAt("server", descriptor, filesBackendPlugin),
        {id: "nbook.test-ledger", entries: [defineEntry({id: "server", location: "server", activationEvents: ["onStartup"], contributions: [{capability: LEDGER_POINT, id: "nbook.test-ledger", declaration: {}}], activate: () => ({contributions: {[LEDGER_POINT]: {"nbook.test-ledger": {record: async (entry: LedgerEntry) => {
            ledger.push(entry);
        }}}}})})]},
    ]});
    const admission = new HttpAdmission();
    admission.ready();
    harnesses.push({stop: async () => {
        await admission.drain();
        expect(await h.parent.stop()).toMatchObject({status: "closed"});
    }});
    const dispatch = createDispatcher({admission, routes, hostRoutes: new Hono(), staticFiles: null, reportError: () => undefined, allowOrigin: (origin: string) => origin === ORIGIN});
    const user = join(h.stateRoot, "user");
    await mkdir(user, {recursive: true});
    // 响应体读完准入才算请求结束，否则停止时的排空一直等：这里先读完。
    const putTo = (route: "theme-assets" | "theme-icons") => async (body: Uint8Array | string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}, host = "127.0.0.1"): Promise<Response> => {
        const response = await dispatch(new Request(`http://${host}:4217/api/nbook.files/${route}`, {method: "PUT", body, headers, ...(body instanceof ReadableStream ? {duplex: "half"} : {})} as RequestInit));
        return new Response(await response.arrayBuffer(), {status: response.status, headers: response.headers});
    };
    const staged = async (): Promise<string[]> => readdir(join(h.stateRoot, "staging")).catch(() => []);
    /** 清理：`POST` JSON；`raw` 给了就原样当请求体（测坏请求）。 */
    const sweep = async (body: unknown, host = "127.0.0.1", raw?: string): Promise<Response> => {
        const response = await dispatch(new Request(`http://${host}:4217/api/nbook.files/theme-assets/sweep`, {method: "POST", body: raw ?? JSON.stringify(body), headers: {"content-type": "application/json"}}));
        return new Response(await response.arrayBuffer(), {status: response.status, headers: response.headers});
    };
    return {user, put: putTo("theme-assets"), putIcon: putTo("theme-icons"), sweep, ledger, staged};
}

describe("写主题场景素材", () => {
    it.each([["png", PNG], ["jpg", JPEG], ["webp", WEBP]] as const)("%s 按字节判定，文件名是内容的哈希，假的类型与文件名不算数", async (extension, bytes) => {
        const {user, put} = await scene();
        const response = await put(bytes, {"content-type": "text/plain", "x-file-name": "evil.svg"});
        expect(response.status).toBe(200);
        const {address} = await response.json() as {address: string};
        expect(address).toBe(`user://theme-assets/${digest(bytes)}.${extension}`);
        expect(new Uint8Array(await readFile(join(user, "theme-assets", `${digest(bytes)}.${extension}`)))).toEqual(bytes);
    });

    it("SVG 与别的内容拒绝，不留文件", async () => {
        const {user, put} = await scene();
        for (const body of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "hello", new Uint8Array([0x89, 0x50])]) {
            const response = await put(body, {"content-type": "image/png"});
            expect(response.status).toBe(415);
            expect(await response.json()).toMatchObject({code: "unsupported-type"});
        }
        expect(await readdir(join(user, "theme-assets")).catch(() => [])).toEqual([]);
    });

    it("超限：没有 Content-Length 的流也在接收时停下，不留文件", async () => {
        const {user, put} = await scene();
        const chunk = new Uint8Array(1024 * 1024);
        chunk.set(PNG);
        let sent = 0;
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                sent += chunk.length;
                controller.enqueue(chunk);
                if (sent > THEME_ASSET_MAX_BYTES * 3) controller.close();
            },
        });
        const response = await put(stream);
        expect(response.status).toBe(413);
        expect(sent).toBeLessThan(THEME_ASSET_MAX_BYTES * 2);
        expect(await readdir(join(user, "theme-assets")).catch(() => [])).toEqual([]);
    });

    it("带 Content-Length（浏览器走的路径）：正好到上限的可以传，多一个字节 413", async () => {
        const {user, put} = await scene();
        const bytes = new Uint8Array(THEME_ASSET_MAX_BYTES);
        bytes.set(PNG);
        expect((await put(bytes, {"content-length": String(bytes.length)})).status).toBe(200);
        const over = new Uint8Array(THEME_ASSET_MAX_BYTES + 1);
        over.set(PNG);
        over[over.length - 1] = 1;
        const response = await put(over, {"content-length": String(over.length)});
        expect(response.status).toBe(413);
        expect(await response.json()).toMatchObject({code: "too-large"});
        expect(await readdir(join(user, "theme-assets"))).toHaveLength(1);
    });

    it("写入归属是 nbook.files，记一条账、不留暂存；已存在时不再记账", async () => {
        const {put, ledger, staged} = await scene();
        expect((await put(PNG)).status).toBe(200);
        expect(ledger).toHaveLength(1);
        expect(ledger[0]?.source).toEqual({kind: "system", plugin: "nbook.files"});
        expect((await put(PNG)).status).toBe(200);
        expect(ledger).toHaveLength(1);
        expect(await staged()).toEqual([]);
    });

    it("经统一的准入：Host 不是回环 421，Origin 不允许 403，都不写文件", async () => {
        const {user, put, ledger} = await scene();
        expect((await put(PNG, {}, "example.com")).status).toBe(421);
        expect((await put(PNG, {origin: "https://evil.example"})).status).toBe(403);
        expect((await put(PNG, {origin: ORIGIN})).status).toBe(200);
        expect(ledger).toHaveLength(1);
        expect(await readdir(join(user, "theme-assets"))).toHaveLength(1);
    });

    it("重复上传返回同一地址；两个窗口并发传同一张都成功，只有一份", async () => {
        const {user, put} = await scene();
        const first = await (await put(PNG)).json();
        expect(await (await put(PNG)).json()).toEqual(first);
        const [a, b] = await Promise.all([put(JPEG), put(JPEG)]);
        expect([a.status, b.status]).toEqual([200, 200]);
        expect((await readdir(join(user, "theme-assets"))).sort()).toEqual([`${digest(JPEG)}.jpg`, `${digest(PNG)}.png`].sort());
    });

    it("同名的文件内容不对或不是文件：冲突，不覆盖", async () => {
        const {user, put} = await scene();
        await mkdir(join(user, "theme-assets"), {recursive: true});
        const path = join(user, "theme-assets", `${digest(PNG)}.png`);
        await writeFile(path, "坏的");
        const response = await put(PNG);
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({code: "conflict"});
        expect(await readFile(path, "utf8")).toBe("坏的");
        await rm(path);
        await mkdir(path);
        expect((await put(PNG)).status).toBe(409);
    });

    it.each([
        ["根内的目录", (user: string) => join(user, "notes")],
        ["根外的目录", (user: string) => join(user, "..", "outside")],
        ["悬空的链接", (user: string) => join(user, "gone")],
    ])("theme-assets 是指向%s的链接：拒绝，目标目录不变", async (_name, target) => {
        const {user, put} = await scene();
        await mkdir(join(user, "notes"), {recursive: true});
        await mkdir(join(user, "..", "outside"), {recursive: true});
        await symlink(target(user), join(user, "theme-assets"));
        const response = await put(PNG);
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({code: "invalid-target"});
        expect(await readdir(join(user, "notes"))).toEqual([]);
        expect(await readdir(join(user, "..", "outside"))).toEqual([]);
    });
});

describe("写主题图标素材", () => {
    it("合格的 SVG：文件名是内容的哈希加 .svg，假的类型与文件名不算数，同一份只存一份并记一条账", async () => {
        const {user, putIcon, ledger} = await scene();
        const response = await putIcon(ICON, {"content-type": "image/png", "x-file-name": "evil.png"});
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({address: `user://theme-assets/${digest(ICON)}.svg`});
        expect(new Uint8Array(await readFile(join(user, "theme-assets", `${digest(ICON)}.svg`)))).toEqual(ICON);
        expect(await (await putIcon(ICON)).json()).toEqual({address: `user://theme-assets/${digest(ICON)}.svg`});
        expect(ledger).toHaveLength(1);
        expect(ledger[0]?.source).toEqual({kind: "system", plugin: "nbook.files"});
    });

    it("不合格的 SVG、位图与别的内容：415，不留文件，说明哪里不合格", async () => {
        const {user, putIcon} = await scene();
        const script = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>';
        for (const body of [script, PNG, "hello"]) {
            const response = await putIcon(body, {"content-type": "image/svg+xml"});
            expect(response.status).toBe(415);
            expect(await response.json()).toMatchObject({code: "unsupported-type"});
        }
        expect(await (await putIcon(script)).json()).toMatchObject({detail: expect.stringContaining("script")});
        expect(await readdir(join(user, "theme-assets")).catch(() => [])).toEqual([]);
    });

    it("场景路由仍拒绝同一个合格的 SVG", async () => {
        const {user, put} = await scene();
        expect((await put(ICON)).status).toBe(415);
        expect(await readdir(join(user, "theme-assets")).catch(() => [])).toEqual([]);
    });

    it("超过 16 KiB：没有 Content-Length 的流与带 Content-Length 的请求都是 413，不留文件；正好到上限的可以传", async () => {
        const {user, putIcon} = await scene();
        const pad = (size: number): Uint8Array => {
            const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>';
            const tail = "</title></svg>";
            return new TextEncoder().encode(head + "a".repeat(size - head.length - tail.length) + tail);
        };
        const exact = pad(THEME_ICON_MAX_BYTES);
        expect(exact.length).toBe(THEME_ICON_MAX_BYTES);
        expect((await putIcon(exact, {"content-length": String(exact.length)})).status).toBe(200);
        const over = pad(THEME_ICON_MAX_BYTES + 1);
        const byHeader = await putIcon(over, {"content-length": String(over.length)});
        expect(byHeader.status).toBe(413);
        expect(await byHeader.json()).toMatchObject({code: "too-large"});
        let sent = 0;
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                sent += over.length;
                controller.enqueue(over);
                if (sent > THEME_ICON_MAX_BYTES * 20) controller.close();
            },
        });
        expect((await putIcon(stream)).status).toBe(413);
        expect(sent).toBeLessThan(THEME_ICON_MAX_BYTES * 10);
        expect(await readdir(join(user, "theme-assets"))).toHaveLength(1);
    });

    it("同名的文件内容不对：冲突，不覆盖；theme-assets 是链接：拒绝；Host 与 Origin 经统一的准入", async () => {
        const {user, putIcon} = await scene();
        expect((await putIcon(ICON, {}, "example.com")).status).toBe(421);
        expect((await putIcon(ICON, {origin: "https://evil.example"})).status).toBe(403);
        await mkdir(join(user, "theme-assets"), {recursive: true});
        const path = join(user, "theme-assets", `${digest(ICON)}.svg`);
        await writeFile(path, "坏的");
        const response = await putIcon(ICON);
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({code: "conflict"});
        expect(await readFile(path, "utf8")).toBe("坏的");
        await rm(join(user, "theme-assets"), {recursive: true});
        await mkdir(join(user, "outside"), {recursive: true});
        await symlink(join(user, "outside"), join(user, "theme-assets"));
        const linked = await putIcon(ICON);
        expect(linked.status).toBe(409);
        expect(await linked.json()).toMatchObject({code: "invalid-target"});
        expect(await readdir(join(user, "outside"))).toEqual([]);
    });
});

describe("清理没人引用的主题素材", () => {
    const HOUR = 60 * 60 * 1000;
    const nameOf = (seed: string): string => `${createHash("sha256").update(seed).digest("hex")}.png`;
    /** 在素材目录里放一个文件，修改时间是 `age` 毫秒之前。 */
    const plant = async (user: string, name: string, age = 2 * HOUR, content = "素材"): Promise<string> => {
        await mkdir(join(user, "theme-assets"), {recursive: true});
        const path = join(user, "theme-assets", name);
        await writeFile(path, content);
        const at = new Date(Date.now() - age);
        await utimes(path, at, at);
        return path;
    };
    const names = async (user: string): Promise<string[]> => (await readdir(join(user, "theme-assets"))).sort();

    it("统计：只列摘要命名的普通文件里没被引用、过了保护期的；别的名字、子目录、符号链接、被引用的、刚写的都不列；统计不删任何东西", async () => {
        const {user, sweep} = await scene();
        const old = nameOf("old");
        const kept = nameOf("kept");
        const fresh = nameOf("fresh");
        await plant(user, old, 2 * HOUR, "12345");
        await plant(user, kept);
        await plant(user, fresh, 60 * 1000);
        await plant(user, "notes.txt");
        await mkdir(join(user, "theme-assets", nameOf("dir")));
        await symlink(join(user, "notes.txt"), join(user, "theme-assets", nameOf("link")));
        const before = await names(user);

        const response = await sweep({keep: [kept]});
        expect(response.status).toBe(200);
        expect(await response.json() as ThemeAssetSweepStats).toEqual({removable: [{name: old, bytes: 5}]});
        expect(await names(user)).toEqual(before);
    });

    it("真删只删 names 里的：未列入统计的不动；列入的删掉，结果逐项交回，别的文件原样", async () => {
        const {user, sweep} = await scene();
        const a = nameOf("a");
        const b = nameOf("b");
        const other = nameOf("other");
        await plant(user, a);
        await plant(user, b);
        await plant(user, other);
        const response = await sweep({keep: [], names: [a, b]});
        expect(response.status).toBe(200);
        expect(await response.json() as ThemeAssetSweepResult).toEqual({removed: [a, b], skipped: []});
        expect(await names(user)).toEqual([other]);
    });

    it("确认期间情况变了：别处新引用了它、或它刚被写过，真删时跳过并说明原因，文件还在；文件已经不在了算 not-file", async () => {
        const {user, sweep} = await scene();
        const nowKept = nameOf("now-kept");
        const touched = nameOf("touched");
        const gone = nameOf("gone");
        await plant(user, nowKept);
        const touchedPath = await plant(user, touched);
        // 统计之后，原地改写并刷新修改时间：目录项身份令牌不变，靠重新核对修改时间挡住。
        const ino = (await stat(touchedPath)).ino;
        await writeFile(touchedPath, "新内容");
        expect((await stat(touchedPath)).ino).toBe(ino);
        const response = await sweep({keep: [nowKept], names: [nowKept, touched, gone]});
        expect(await response.json() as ThemeAssetSweepResult).toEqual({removed: [], skipped: [{name: nowKept, reason: "kept"}, {name: touched, reason: "recent"}, {name: gone, reason: "not-file"}]});
        expect(await names(user)).toEqual([nowKept, touched].sort());
    });

    it("只刷新修改时间（同一个 inode）也在保护期里，不删", async () => {
        const {user, sweep} = await scene();
        const name = nameOf("touch-only");
        const path = await plant(user, name);
        const ino = (await stat(path)).ino;
        await utimes(path, new Date(), new Date());
        expect((await stat(path)).ino).toBe(ino);
        expect(await (await sweep({keep: []})).json()).toEqual({removable: []});
        expect(await (await sweep({keep: [], names: [name]})).json()).toEqual({removed: [], skipped: [{name, reason: "recent"}]});
        expect(await names(user)).toEqual([name]);
    });

    it("上传命中已有的旧文件：磁盘上的文件不被改动，但清理把它当刚被引用，不删（不用 utimes）", async () => {
        const {user, put, sweep, ledger} = await scene();
        const name = `${digest(PNG)}.png`;
        const path = await plant(user, name, 2 * HOUR, "x");
        await writeFile(path, PNG);
        const at = new Date(Date.now() - 2 * HOUR);
        await utimes(path, at, at);
        const before = (await stat(path)).mtimeMs;
        expect(await (await sweep({keep: []})).json()).toEqual({removable: [{name, bytes: PNG.length}]});

        expect((await put(PNG)).status).toBe(200);
        expect((await stat(path)).mtimeMs).toBe(before);
        expect(ledger).toHaveLength(0);
        expect(await (await sweep({keep: []})).json()).toEqual({removable: []});
        expect(await (await sweep({keep: [], names: [name]})).json()).toEqual({removed: [], skipped: [{name, reason: "recent"}]});
        expect(await names(user)).toEqual([name]);
    });

    it("清理与同一份素材的上传：先后与同时来，上传交出的地址指向的文件总是存在（每种情形各用新的场地，内存里的最近返回表互不影响）", async () => {
        const oldPlant = async (user: string): Promise<string> => {
            const name = `${digest(PNG)}.png`;
            const path = await plant(user, name);
            await writeFile(path, PNG);
            const at = new Date(Date.now() - 2 * HOUR);
            await utimes(path, at, at);
            return name;
        };
        // 先上传后清理：上传命中旧文件，进入保护期，清理跳过它。
        {
            const {user, put, sweep} = await scene();
            const name = await oldPlant(user);
            expect((await put(PNG)).status).toBe(200);
            expect(await (await sweep({keep: [], names: [name]})).json()).toEqual({removed: [], skipped: [{name, reason: "recent"}]});
            expect(await names(user)).toEqual([name]);
        }
        // 先清理后上传：清理删掉旧文件，随后的上传重新写入，交出的地址指向存在的文件。
        {
            const {user, put, sweep} = await scene();
            const name = await oldPlant(user);
            expect(await (await sweep({keep: [], names: [name]})).json()).toEqual({removed: [name], skipped: []});
            expect((await put(PNG)).status).toBe(200);
            expect(new Uint8Array(await readFile(join(user, "theme-assets", name)))).toEqual(PNG);
        }
        // 同时来：不管互斥放谁先，结果都是文件存在、内容是上传的字节。
        for (const order of ["sweep-then-upload", "upload-then-sweep"] as const) {
            const {user, put, sweep} = await scene();
            const name = await oldPlant(user);
            const results = await Promise.all(order === "upload-then-sweep" ? [put(PNG), sweep({keep: [], names: [name]})] : [sweep({keep: [], names: [name]}), put(PNG)]);
            expect(results.map((response) => response.status)).toEqual([200, 200]);
            expect(await names(user)).toEqual([name]);
            expect(new Uint8Array(await readFile(join(user, "theme-assets", name)))).toEqual(PNG);
        }
    });

    it("统计有上限：候选超过 8192 个只列前一批并标 truncated，不无界地扫描与拼响应；清掉这一批之后再统计看后面的", async () => {
        const {user, sweep} = await scene();
        const dir = join(user, "theme-assets");
        await mkdir(dir, {recursive: true});
        const at = new Date(Date.now() - 2 * HOUR);
        const total = THEME_ASSET_SWEEP_MAX_NAMES + 3;
        const all = Array.from({length: total}, (_, index) => nameOf(`many-${String(index)}`)).sort();
        await Promise.all(all.map(async (name) => {
            await writeFile(join(dir, name), "x");
            await utimes(join(dir, name), at, at);
        }));
        const first = await (await sweep({keep: []})).json() as ThemeAssetSweepStats;
        expect(first.removable).toHaveLength(THEME_ASSET_SWEEP_MAX_NAMES);
        expect(first.truncated).toBe(true);
        expect(first.removable.map(({name}) => name)).toEqual(all.slice(0, THEME_ASSET_SWEEP_MAX_NAMES));
        const done = await (await sweep({keep: [], names: first.removable.map(({name}) => name)})).json() as ThemeAssetSweepResult;
        expect(done.removed).toHaveLength(THEME_ASSET_SWEEP_MAX_NAMES);
        const rest = await (await sweep({keep: []})).json() as ThemeAssetSweepStats;
        expect(rest.removable.map(({name}) => name)).toEqual(all.slice(THEME_ASSET_SWEEP_MAX_NAMES));
        expect(rest.truncated).toBeUndefined();
    }, 60_000);

    it("素材目录读不了（权限）：500 io-error，不当成“目录是空的”；单个文件查不了记 failed 并带码，不伪装成 not-file", async () => {
        const {user, sweep} = await scene();
        const old = nameOf("blocked");
        await plant(user, old);
        const dir = join(user, "theme-assets");
        await chmod(dir, 0o000);
        try {
            const stats = await sweep({keep: []});
            expect(stats.status).toBe(500);
            expect(await stats.json()).toMatchObject({code: "io-error", detail: expect.stringContaining("EACCES")});
            const removal = await sweep({keep: [], names: [old]});
            expect(await removal.json()).toEqual({removed: [], skipped: [{name: old, reason: "failed", code: "EACCES"}]});
        } finally {
            await chmod(dir, 0o755);
        }
        expect(await names(user)).toEqual([old]);
    });

    it("统计之后素材目录被换成指向根内别处的链接：真删跳过，别处同名的文件不动", async () => {
        const {user, sweep} = await scene();
        const old = nameOf("swapped");
        await plant(user, old);
        const stats = await (await sweep({keep: []})).json() as ThemeAssetSweepStats;
        expect(stats.removable.map(({name}) => name)).toEqual([old]);
        // 通用入口在统计与确认之间做的事：把目录挪走，原位置放一个指向别处的链接，别处有同名的旧文件。
        await mkdir(join(user, "other"), {recursive: true});
        const elsewhere = await plant(join(user, "other"), old);
        await rm(join(user, "theme-assets", old));
        await rm(join(user, "theme-assets"), {recursive: true});
        await symlink(join(user, "other", "theme-assets"), join(user, "theme-assets"));
        const response = await sweep({keep: [], names: [old]});
        expect([response.status, await response.json()]).toEqual([409, expect.objectContaining({code: "invalid-target"})]);
        expect(await readFile(elsewhere, "utf8")).toBe("素材");
    });

    it("keep 超过 4096 个唯一名字也照常清理；超过上限、不是名字数组、名字不合格、不是 JSON：400，不删任何东西", async () => {
        const {user, sweep} = await scene();
        const old = nameOf("old");
        await plant(user, old);
        const many = Array.from({length: 5000}, (_, index) => nameOf(`keep-${String(index)}`));
        expect(await (await sweep({keep: many})).json()).toEqual({removable: [{name: old, bytes: 6}]});
        // 8192 项正好可以，装得下 user-themes 记录最大能表达的唯一引用数。
        const full = Array.from({length: THEME_ASSET_SWEEP_MAX_NAMES}, (_, index) => nameOf(`full-${String(index)}`));
        expect((await sweep({keep: full})).status).toBe(200);
        for (const body of [{keep: [...full, nameOf("one-more")]}, {keep: "x"}, {keep: ["../etc/passwd"]}, {keep: [nameOf("a").toUpperCase()]}, {keep: [], names: [nameOf("x"), 3]}, {keep: [], names: "x"}, {}, null, [1]]) {
            const response = await sweep(body);
            expect(response.status).toBe(400);
            expect(await response.json()).toMatchObject({code: "bad-request"});
        }
        expect((await sweep(null, "127.0.0.1", "不是 JSON")).status).toBe(400);
        expect(await names(user)).toEqual([old]);
        const oversize = await sweep(null, "127.0.0.1", JSON.stringify({keep: [], pad: "x".repeat(THEME_ASSET_SWEEP_MAX_BYTES)}));
        expect(oversize.status).toBe(413);
    });

    it("素材目录不存在：统计与真删都返回空；是链接：409，目标目录不变", async () => {
        const {user, sweep} = await scene();
        expect(await (await sweep({keep: []})).json()).toEqual({removable: []});
        expect(await (await sweep({keep: [], names: [nameOf("a")]})).json()).toEqual({removed: [], skipped: []});
        await mkdir(join(user, "outside"), {recursive: true});
        await writeFile(join(user, "outside", nameOf("a")), "别的目录里的");
        await symlink(join(user, "outside"), join(user, "theme-assets"));
        const response = await sweep({keep: [], names: [nameOf("a")]});
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({code: "invalid-target"});
        expect(await readdir(join(user, "outside"))).toEqual([nameOf("a")]);
    });

    it("符号链接与子目录即使点名也不删；经统一的准入：Host 不是回环 421", async () => {
        const {user, sweep} = await scene();
        await plant(user, "target.txt");
        const link = nameOf("link");
        await symlink(join(user, "theme-assets", "target.txt"), join(user, "theme-assets", link));
        const dir = nameOf("dir");
        await mkdir(join(user, "theme-assets", dir));
        const response = await sweep({keep: [], names: [link, dir]});
        expect(await response.json()).toEqual({removed: [], skipped: [{name: link, reason: "not-file"}, {name: dir, reason: "not-file"}]});
        expect(await names(user)).toEqual([dir, link, "target.txt"].sort());
        expect((await sweep({keep: []}, "example.com")).status).toBe(421);
    });
});

describe("清理对 Files 删除结果的处理", () => {
    const HOUR = 60 * 60 * 1000;
    const hash = (seed: string): string => `${createHash("sha256").update(seed).digest("hex")}.png`;

    /** 路由接在 tmp 目录上，删除换成按脚本返回的替身（形状是 Files 的 `BatchResult`）；判据是路由交回的结果。 */
    async function withDelete(outcomes: Array<ServerFilesResult<BatchResult>>, afterDelete: (user: string, names: string[]) => Promise<void> = async () => undefined): Promise<{post: (body: unknown) => Promise<Response>; names: string[]; user: string; deleted: string[]}> {
        const user = join(tmp, `delete-shape-${String(Math.random()).slice(2)}`);
        await mkdir(join(user, "theme-assets"), {recursive: true});
        const planted = [hash("a"), hash("b"), hash("c")];
        for (const name of planted) {
            await writeFile(join(user, "theme-assets", name), "x");
            const at = new Date(Date.now() - 2 * HOUR);
            await utimes(join(user, "theme-assets", name), at, at);
        }
        const deleted: string[] = [];
        const app = new Hono<{Bindings: HttpRouteEnv}>();
        addThemeAssetRoutes(app, {
            userRoot: user,
            write: async () => ({ok: false, code: "invalid-input", detail: "不写"}),
            delete: async (items) => {
                deleted.push(...items.map(({address}) => address.split("/").pop()!));
                const outcome = outcomes.shift() ?? {ok: true, value: {items: [{status: "done" as const}], manifests: []}};
                await afterDelete(user, planted);
                return outcome;
            },
        });
        return {post: (body) => Promise.resolve(app.request("/theme-assets/sweep", {method: "POST", body: JSON.stringify(body), headers: {"content-type": "application/json"}})), names: planted, user, deleted};
    }

    it("逐项失败记进 skipped 并带 Files 的码，后面的照常删", async () => {
        const {post, names, deleted} = await withDelete([{ok: true, value: {items: [{status: "failed", code: "permission-denied", detail: "只读"}], manifests: []}}]);
        const response = await post({keep: [], names});
        expect(await response.json()).toEqual({removed: [names[1], names[2]], skipped: [{name: names[0], reason: "failed", code: "permission-denied"}]});
        expect(deleted).toEqual(names);
    });

    it("删除途中素材目录被换成指向根内别处的链接：后面的项逐项前复核到了，不再删，别处同名的文件不动", async () => {
        let elsewhere = "";
        const {post, names, deleted} = await withDelete([], async (user, planted) => {
            // 第一项删完之后，通用入口把目录挪走、原位置放一个链接，指向放着其余同名旧文件的地方。
            if (elsewhere !== "") return;
            elsewhere = join(user, "other");
            await mkdir(elsewhere, {recursive: true});
            for (const name of planted.slice(1)) await writeFile(join(elsewhere, name), "别处的");
            await rm(join(user, "theme-assets"), {recursive: true});
            await symlink(elsewhere, join(user, "theme-assets"));
        });
        const response = await post({keep: [], names});
        expect(await response.json()).toEqual({removed: [names[0]], skipped: [{name: names[1], reason: "not-file"}, {name: names[2], reason: "not-file"}]});
        expect(deleted).toEqual([names[0]]);
        expect((await readdir(elsewhere)).sort()).toEqual(names.slice(1).sort());
    });

    it("整次调用失败：停下，500 带码，已经删掉的照实交回，后面的不再发", async () => {
        const {post, names, deleted} = await withDelete([{ok: true, value: {items: [{status: "done"}], manifests: []}}, {ok: false, code: "root-gone", detail: "根不在了"}]);
        const response = await post({keep: [], names});
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({code: "root-gone", detail: "根不在了", removed: [names[0]], skipped: []});
        expect(deleted).toEqual([names[0], names[1]]);
    });

    it("这一项没运行（not-run）：同样停下，500，不当成成功", async () => {
        const {post, names} = await withDelete([{ok: true, value: {items: [{status: "not-run", reason: "stopped"}], manifests: []}}]);
        const response = await post({keep: [], names});
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({code: "not-run", removed: []});
    });
});

describe("素材目录的互斥", () => {
    it("前一个任务抛错也不影响后面的任务排队与执行，队尾不卡住；结果按先后顺序", async () => {
        const guard = new ThemeAssetGuard();
        const order: string[] = [];
        const first = guard.run(async () => {
            order.push("first");
            throw new Error("坏了");
        });
        const second = guard.run(async () => {
            order.push("second");
            return "ok";
        });
        await expect(first).rejects.toThrow("坏了");
        expect(await second).toBe("ok");
        expect(order).toEqual(["first", "second"]);
        // 慢的任务没结束时，后来的不开始。
        const gate = Promise.withResolvers<void>();
        const slow = guard.run(async () => {
            order.push("slow-start");
            await gate.promise;
            order.push("slow-end");
        });
        const after = guard.run(async () => {
            order.push("after");
        });
        await Promise.resolve();
        expect(order.slice(2)).toEqual(["slow-start"]);
        gate.resolve();
        await Promise.all([slow, after]);
        expect(order.slice(2)).toEqual(["slow-start", "slow-end", "after"]);
    });
});
