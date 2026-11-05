/**
 * 写背景图片（docs/specs/workspace/files.md 的“写背景图片”）：路由接真实的文件服务，提交走真实的暂存与记账，判据是磁盘上的结果。
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
import type {ProjectHarness} from "nbook/server/testing/projects";

import {addBackgroundRoutes, BACKGROUND_MAX_BYTES} from "./backend/background-route";
import {filesBackendPlugin} from "./backend/plugin";
import {descriptor} from "./plugin";
import {workspaceFilesKey} from "./shared/workspace-files";
import type {WorkspaceFiles} from "./shared/workspace-files";

let tmp = "";
const harnesses: ProjectHarness[] = [];
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "background-route");
});
afterEach(async () => {
    try {
        for (const harness of harnesses.splice(0)) expect(await harness.parent.stop()).toMatchObject({status: "closed"});
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
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

async function scene() {
    let files: WorkspaceFiles | null = null;
    const h = await projectHarness(tmp, {plugins: [
        createDiagnosticsPlugin({location: "server", store: createDiagnosticsStore({identity: {location: "server", instanceId: "test"}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)}),
        definitionAt("server", descriptor, filesBackendPlugin),
        {id: "x.writer", entries: [defineEntry({id: "server", location: "server", activationEvents: ["onStartup"], dependencies: [{key: workspaceFilesKey}], activate: (context) => {
            files = context.services.require(workspaceFilesKey);
            return {};
        }})]},
    ]});
    harnesses.push(h);
    const user = join(h.root, "state", "user");
    await mkdir(user, {recursive: true});
    const app = new Hono();
    addBackgroundRoutes(app as never, {userRoot: user, write: (address, bytes) => (files as unknown as WorkspaceFiles).write(address, bytes, {expect: "absent", createParents: true})});
    const put = (body: Uint8Array | string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) => app.fetch(new Request("http://127.0.0.1/backgrounds", {method: "PUT", body, headers, ...(body instanceof ReadableStream ? {duplex: "half"} : {})} as RequestInit));
    return {user, put};
}

describe("写背景图片", () => {
    it.each([["png", PNG], ["jpg", JPEG], ["webp", WEBP]] as const)("%s 按字节判定，文件名是内容的哈希，假的类型与文件名不算数", async (extension, bytes) => {
        const {user, put} = await scene();
        const response = await put(bytes, {"content-type": "text/plain", "x-file-name": "evil.svg"});
        expect(response.status).toBe(200);
        const {address} = await response.json() as {address: string};
        expect(address).toBe(`user://backgrounds/${digest(bytes)}.${extension}`);
        expect(new Uint8Array(await readFile(join(user, "backgrounds", `${digest(bytes)}.${extension}`)))).toEqual(bytes);
    });

    it("SVG 与别的内容拒绝，不留文件", async () => {
        const {user, put} = await scene();
        for (const body of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "hello", new Uint8Array([0x89, 0x50])]) {
            const response = await put(body, {"content-type": "image/png"});
            expect(response.status).toBe(415);
            expect(await response.json()).toMatchObject({code: "unsupported-type"});
        }
        expect(await readdir(join(user, "backgrounds")).catch(() => [])).toEqual([]);
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
                if (sent > BACKGROUND_MAX_BYTES * 3) controller.close();
            },
        });
        const response = await put(stream);
        expect(response.status).toBe(413);
        expect(sent).toBeLessThan(BACKGROUND_MAX_BYTES * 2);
        expect(await readdir(join(user, "backgrounds")).catch(() => [])).toEqual([]);
    });

    it("正好到上限的可以传", async () => {
        const {put} = await scene();
        const bytes = new Uint8Array(BACKGROUND_MAX_BYTES);
        bytes.set(PNG);
        expect((await put(bytes)).status).toBe(200);
    });

    it("重复上传返回同一地址；两个窗口并发传同一张都成功，只有一份", async () => {
        const {user, put} = await scene();
        const first = await (await put(PNG)).json();
        expect(await (await put(PNG)).json()).toEqual(first);
        const [a, b] = await Promise.all([put(JPEG), put(JPEG)]);
        expect([a.status, b.status]).toEqual([200, 200]);
        expect((await readdir(join(user, "backgrounds"))).sort()).toEqual([`${digest(JPEG)}.jpg`, `${digest(PNG)}.png`].sort());
    });

    it("同名的文件内容不对或不是文件：冲突，不覆盖", async () => {
        const {user, put} = await scene();
        await mkdir(join(user, "backgrounds"), {recursive: true});
        const path = join(user, "backgrounds", `${digest(PNG)}.png`);
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
    ])("backgrounds 是指向%s的链接：拒绝，目标目录不变", async (_name, target) => {
        const {user, put} = await scene();
        await mkdir(join(user, "notes"), {recursive: true});
        await mkdir(join(user, "..", "outside"), {recursive: true});
        await symlink(target(user), join(user, "backgrounds"));
        const response = await put(PNG);
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({code: "invalid-target"});
        expect(await readdir(join(user, "notes"))).toEqual([]);
        expect(await readdir(join(user, "..", "outside"))).toEqual([]);
    });
});
