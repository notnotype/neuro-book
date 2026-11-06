/**
 * 附件的上传与读取路由（docs/specs/agent/sessions.md 的“附件”）：真实内核的文件服务、真实会话目录，HTTP 请求直接交给路由。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {workspaceFilesKey} from "nbook/plugins/files/shared/contracts";
import type {WorkspaceFiles} from "nbook/plugins/files/shared/contracts";

import {createAttachmentRoutes, sessionDirectoryExists} from "./backend/attachments";
import {MAIN_PROFILE} from "./shared/contracts";
import {ATTACHMENT_LIMIT_BYTES} from "./shared/attachments";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

let root = "";
let endpoint: FakeEndpoint;
let counter = 0;
const worlds: AgentWorld[] = [];

beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "attachments");
    endpoint = fakeEndpoint();
});
afterEach(async () => {
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    endpoint.stop();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

/** 1×1 的透明 PNG。 */
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));
const IMAGE_URL = /^sessions:\/\/[^/]+\/home\/attachments\/([0-9a-f]{64}\.png)$/u;

async function routes() {
    counter += 1;
    let files: WorkspaceFiles | null = null;
    const probe: PluginDefinition = {id: "test.attachments-probe", entries: [defineEntry({id: "server", location: "server", activationEvents: ["onStartup"], dependencies: [{key: workspaceFilesKey}], activate: (context) => {
        files = context.services.require(workspaceFilesKey);
        return {};
    }})]};
    const w = await agentWorld(join(root, `w${String(counter)}`), {plugins: [probe], userSettings: localModelSettings(endpoint.baseUrl)});
    worlds.push(w);
    const created = await w.service.create({profile: MAIN_PROFILE});
    if (!created.ok) throw new Error(created.code);
    const listed = await w.service.list({});
    if (!listed.ok) throw new Error(listed.code);
    const session = listed.value[0]!.id;
    const app = createAttachmentRoutes({files: files as unknown as WorkspaceFiles, hasSession: sessionDirectoryExists(join(w.stateRoot, "agent", "sessions"))});
    const request = (path: string, init?: RequestInit) => app.request(path, init, {} as never);
    const post = (body: string | Uint8Array, headers: Record<string, string> = {}) => request(`/sessions/${session}/attachments`, {method: "POST", body, headers});
    return {session, request, post};
}

describe("上传", () => {
    test("图片按文件头认，不信声明；文件名是内容的哈希，同一内容地址不变", async () => {
        const {post} = await routes();
        const first = await post(PNG, {"content-type": "text/plain", "x-attachment-name": encodeURIComponent("草图.png")});
        expect(first.status).toBe(200);
        const body = await first.json() as {uri: string; kind: string; mime: string; name: string};
        expect(body).toMatchObject({kind: "image", mime: "image/png", name: "草图.png"});
        expect(body.uri).toMatch(IMAGE_URL);
        const again = await (await post(PNG)).json() as {uri: string};
        expect(again.uri).toBe(body.uri);
    });

    test("声明是图片、文件头不是的（SVG）与没声明类型的，都按只能下载的普通文件存", async () => {
        const {post} = await routes();
        const svg = await (await post("<svg></svg>", {"content-type": "image/svg+xml"})).json() as {kind: string; mime: string; uri: string};
        expect(svg).toMatchObject({kind: "file", mime: "application/octet-stream"});
        expect(svg.uri.endsWith(".bin")).toBe(true);
        const bare = await (await post(new Uint8Array([1, 2, 3]))).json() as {mime: string};
        expect(bare.mime).toBe("application/octet-stream");
    });

    test("超过上限 413；不存在的会话 404；别的网页 403", async () => {
        const {post, request} = await routes();
        const tooLarge = await post(new Uint8Array(ATTACHMENT_LIMIT_BYTES + 1));
        expect(tooLarge.status).toBe(413);
        expect((await request("/sessions/没有/attachments", {method: "POST", body: PNG})).status).toBe(404);
        expect((await request("/sessions/../attachments", {method: "POST", body: PNG})).status).toBe(404);
        expect((await post(PNG, {"sec-fetch-site": "cross-site"})).status).toBe(403);
    });
});

describe("读取", () => {
    test("GET 交回内容与缓存头，带 ETag 的 304，HEAD 没有内容；SVG 这类只能下载", async () => {
        const {post, request, session} = await routes();
        const {uri} = await (await post(PNG)).json() as {uri: string};
        const name = IMAGE_URL.exec(uri)![1]!;
        const path = `/sessions/${session}/attachments/${name}`;

        const got = await request(path);
        expect(got.status).toBe(200);
        expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG);
        expect(got.headers.get("content-type")).toBe("image/png");
        expect(got.headers.get("content-security-policy")).toBe("sandbox");
        const etag = got.headers.get("etag")!;

        expect((await request(path, {headers: {"if-none-match": etag}})).status).toBe(304);
        const head = await request(path, {method: "HEAD"});
        expect(head.status).toBe(200);
        expect(head.headers.get("content-length")).toBe(String(PNG.length));
        expect((await head.arrayBuffer()).byteLength).toBe(0);

        const svg = await (await post("<svg></svg>", {"content-type": "image/svg+xml"})).json() as {uri: string};
        const download = await request(`/sessions/${session}/attachments/${svg.uri.slice(svg.uri.lastIndexOf("/") + 1)}`);
        expect(download.headers.get("content-type")).toBe("application/octet-stream");
        expect(download.headers.get("content-disposition")).toContain("attachment");
    });

    test("不存在的会话、不存在的文件 404；文件名不对 400；别的网页 403", async () => {
        const {post, request, session} = await routes();
        const {uri} = await (await post(PNG)).json() as {uri: string};
        const name = IMAGE_URL.exec(uri)![1]!;
        for (const method of ["GET", "HEAD"]) {
            expect((await request(`/sessions/没有/attachments/${name}`, {method})).status).toBe(404);
        }
        expect((await request(`/sessions/${session}/attachments/${"0".repeat(64)}.png`)).status).toBe(404);
        expect((await request(`/sessions/${session}/attachments/a.png`)).status).toBe(400);
        expect((await request(`/sessions/${session}/attachments/${name}`, {headers: {"sec-fetch-site": "cross-site"}})).status).toBe(403);
    });
});
