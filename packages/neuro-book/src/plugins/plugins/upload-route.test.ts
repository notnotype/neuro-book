/**
 * 插件文件夹上传的路由（backend/upload-route.ts，plugin-install 输出 11 与上传接口）：真实的 `Bun.serve`、真实的暂存区与文件系统；
 * 请求用真实的 `fetch`，请求体是流（没有 `Content-Length`）。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {readdir, rm} from "node:fs/promises";
import {join} from "node:path";

import type {HttpRouteEnv} from "@notnotype/nb-host/http/contracts";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createPluginUploads} from "nbook/plugin-platform/backend/uploads";
import {encodeFrameHeader} from "nbook/plugin-platform/shared/plugin-upload";

import {createPluginUploadRoutes} from "./backend/upload-route";

let tmp = "";
const servers: Array<ReturnType<typeof Bun.serve>> = [];
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-plugin-upload-route", "上传路由");
});
afterAll(async () => {
    for (const server of servers) await server.stop(true);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const encoder = new TextEncoder();
let cases = 0;

function start(limits?: {maxFiles: number; maxTotalBytes: number; maxFileBytes: number}) {
    cases += 1;
    const root = join(tmp, `case-${String(cases)}`);
    const uploads = createPluginUploads({root, clock: systemClock, record: () => undefined, ...(limits === undefined ? {} : {limits})});
    const app = createPluginUploadRoutes(uploads, limits);
    const env: HttpRouteEnv = {registerEventStream: () => undefined as never};
    const server = Bun.serve({port: 0, hostname: "127.0.0.1", fetch: (request) => app.fetch(request, env)});
    servers.push(server);
    return {root, uploads, url: `http://127.0.0.1:${String(server.port)}`};
}

function frames(files: Record<string, string>): Uint8Array {
    const parts: Uint8Array[] = [];
    for (const [path, content] of Object.entries(files)) parts.push(encodeFrameHeader(path, encoder.encode(content).length), encoder.encode(content));
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

/** 分块流：没有 `Content-Length`，和浏览器 `fetch` 流式上传一样走 chunked。 */
function chunked(bytes: Uint8Array, size = 16): ReadableStream<Uint8Array> {
    let offset = 0;
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            if (offset >= bytes.length) return controller.close();
            controller.enqueue(bytes.slice(offset, offset + size));
            offset += size;
        },
    });
}

type Body = ReadableStream<Uint8Array> | Uint8Array;
const post = (url: string, body: Body | null) => fetch(`${url}/uploads`, {method: "POST", body, duplex: "half"} as RequestInit);

describe("上传路由", () => {
    it("POST 接收整个文件夹：交回 id、文件数与字节数，暂存目录里有文件；DELETE 删掉，再删也是 204", async () => {
        const {url, root} = start();
        const sent = frames({"package.json": "{}", "dist/index.js": "1"});
        const response = await post(url, chunked(sent));
        expect(response.status).toBe(200);
        const {id, files, bytes} = (await response.json()) as {id: string; files: number; bytes: number};
        expect(files).toBe(2);
        expect(bytes).toBe(sent.length);
        expect((await readdir(join(root, id))).sort()).toEqual(["dist", "package.json"]);
        expect((await fetch(`${url}/uploads/${id}`, {method: "DELETE"})).status).toBe(204);
        expect((await fetch(`${url}/uploads/${id}`, {method: "DELETE"})).status).toBe(204);
        expect(await readdir(root)).toEqual([]);
    });

    it("失败体是 {code, detail}：路径不合规与分帧不对 400，没有请求体 400，超限 413（流里数的，请求没有 Content-Length），都不留下上传", async () => {
        const limits = {maxFiles: 5, maxTotalBytes: 200, maxFileBytes: 60};
        const {url, root} = start(limits);
        const cases: Array<[string, Body | null, number, string]> = [
            ["路径不合规", chunked(frames({"../evil.txt": "x"})), 400, "upload-path-invalid"],
            ["分帧不对", chunked(encoder.encode("这不是分帧的请求体")), 400, "upload-malformed"],
            ["没有请求体", null, 400, "upload-malformed"],
            ["单个文件超限", chunked(frames({"a.bin": "x".repeat(61)})), 413, "upload-too-large"],
            ["总量超限", chunked(frames({"a": "x".repeat(60), "b": "x".repeat(60), "c": "x".repeat(60)})), 413, "upload-too-large"],
        ];
        for (const [name, body, status, code] of cases) {
            const response = await post(url, body);
            expect([name, response.status, ((await response.json()) as {code: string; detail: string}).code]).toEqual([name, status, code]);
            expect(await readdir(root).catch(() => [])).toEqual([]);
        }
    });

    it("客户端上传到一半断开：服务端收尾，暂存区不留目录", async () => {
        const {url, root, uploads} = start();
        const controller = new AbortController();
        // 一个文件写了一部分、下一帧只有半个头，然后停住等待。
        const first = frames({"a.txt": "12345"});
        const stalled = new ReadableStream<Uint8Array>({
            start(stream) {
                stream.enqueue(first);
                stream.enqueue(new Uint8Array([0, 0]));
            },
        });
        const sending = fetch(`${url}/uploads`, {method: "POST", body: stalled, duplex: "half", signal: controller.signal} as RequestInit).catch((error: unknown) => error);
        // 等第一个文件落盘（上传在接收中，登记了一个目录）。
        await waitUntil("登记了一个接收中的上传", async () => (await readdir(root).catch(() => [])).length > 0);
        expect((await readdir(root)).length).toBe(1);
        controller.abort();
        await sending;
        await waitUntil("断开的上传被删掉", async () => (await readdir(root)).length === 0);
        // 断开后新的上传照常收。
        expect((await post(url, chunked(frames({"b.txt": "1"})))).status).toBe(200);
        await uploads.stop();
    });

    it("请求声明了 Content-Length 且超限：当场 413，不读请求体", async () => {
        const limits = {maxFiles: 5, maxTotalBytes: 100, maxFileBytes: 60};
        const {url, root} = start(limits);
        const response = await post(url, new Uint8Array(500));
        expect(response.status).toBe(413);
        expect(((await response.json()) as {code: string}).code).toBe("upload-too-large");
        expect(await readdir(root).catch(() => [])).toEqual([]);
    });

    it("上传满了（同时在接收的占满）：429 upload-busy", async () => {
        const {url, root} = start();
        // 8 个都没收完：每个都发了帧头一半就停住。
        const open: Array<() => void> = [];
        const stalled = Array.from({length: 8}, () => {
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new Uint8Array([0, 0]));
                    open.push(() => controller.close());
                },
            });
            return post(url, stream).catch(() => undefined);
        });
        // 每个停住的上传都建了自己的目录，这时 8 个位都占了。
        await waitUntil("8 个上传都在接收", async () => (await readdir(root).catch(() => [])).length === 8);
        const busy = await post(url, chunked(frames({"a.txt": "1"})));
        expect(busy.status).toBe(429);
        expect(((await busy.json()) as {code: string}).code).toBe("upload-busy");
        for (const close of open) close();
        await Promise.all(stalled);
    });
});
