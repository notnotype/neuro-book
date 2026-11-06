/**
 * 写主题场景素材（docs/specs/theme/editor.md 的“写场景素材”）：路由接真实的文件服务，提交走真实的暂存与记账，判据是磁盘上的结果。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {createHash} from "node:crypto";
import {mkdir, readdir, readFile, rm, symlink, writeFile} from "node:fs/promises";
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
import {THEME_ASSET_MAX_BYTES} from "./shared/contracts";
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
    const put = async (body: Uint8Array | string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}, host = "127.0.0.1"): Promise<Response> => {
        const response = await dispatch(new Request(`http://${host}:4217/api/nbook.files/theme-assets`, {method: "PUT", body, headers, ...(body instanceof ReadableStream ? {duplex: "half"} : {})} as RequestInit));
        return new Response(await response.arrayBuffer(), {status: response.status, headers: response.headers});
    };
    const staged = async (): Promise<string[]> => readdir(join(h.stateRoot, "staging")).catch(() => []);
    return {user, put, ledger, staged};
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
