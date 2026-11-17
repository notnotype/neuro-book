/**
 * 插件页的文件夹上传（folder-upload.ts）：页面拼的请求体交给服务端的读取器（真实实现，同一份分帧）读一遍；上传客户端用 `XMLHttpRequest`
 * 的替身（只替换网络，应答是服务端真实的失败体形状）。
 */

import {describe, expect, it} from "vitest";

import {readUploadStream, UploadError} from "nbook/shared/plugin-upload";
import type {UploadFileSink} from "nbook/shared/plugin-upload";
import type {CollectedFolder} from "nbook/shared/collected-folder";

import {buildUploadBody, createFolderUploadClient, pluginFolderProblem} from "./folder-upload";
import type {UploadRequest} from "./folder-upload";

function folderOf(files: Record<string, string>): CollectedFolder {
    const list = Object.entries(files).map(([path, content]) => ({path, file: new File([content], path.split("/").pop()!)}));
    return {name: "plugin", files: list, bytes: list.reduce((sum, item) => sum + item.file.size, 0)};
}

describe("上传的请求体", () => {
    it("页面拼的请求体能被服务端的读取器原样读出：路径、内容（含中文与空文件）", async () => {
        const folder = folderOf({"package.json": '{"name":"x"}', "dist/index.js": "export {};\n", "资源/说明.md": "你好", "empty.txt": ""});
        const received = new Map<string, string>();
        const sink = (path: string): UploadFileSink => {
            const chunks: Uint8Array[] = [];
            return {
                write: (chunk) => Promise.resolve(void chunks.push(chunk.slice())),
                end: async () => void received.set(path, await new Blob(chunks as BlobPart[]).text()),
                abort: () => Promise.resolve(),
            };
        };
        const result = await readUploadStream(buildUploadBody(folder).stream(), {open: (path) => Promise.resolve(sink(path))});
        expect(result.files).toBe(4);
        expect(Object.fromEntries(received)).toEqual({"package.json": '{"name":"x"}', "dist/index.js": "export {};\n", "资源/说明.md": "你好", "empty.txt": ""});
    });

    it("页面不先查路径时，服务端的读取器照样拒绝不合规的路径（两边规则一致）", async () => {
        const body = buildUploadBody(folderOf({"../evil.js": "x"}));
        await expect(readUploadStream(body.stream(), {open: () => Promise.reject(new Error("不该开"))})).rejects.toBeInstanceOf(UploadError);
    });
});

describe("像不像一个插件", () => {
    it("根目录有 package.json 就像；没有时恰有一个子目录有，说明多拖了一层；其余都是没有清单", () => {
        expect(pluginFolderProblem(folderOf({"package.json": "{}", "dist/a.js": "1"}))).toBeNull();
        expect(pluginFolderProblem(folderOf({"my-plugin/package.json": "{}", "my-plugin/dist/a.js": "1", "notes.txt": "n"}))).toEqual({kind: "nested", name: "my-plugin"});
        expect(pluginFolderProblem(folderOf({"a/package.json": "{}", "b/package.json": "{}"}))).toEqual({kind: "no-manifest"});
        expect(pluginFolderProblem(folderOf({"readme.md": "x", "deep/er/package.json": "{}"}))).toEqual({kind: "no-manifest"});
    });
});

/** `XMLHttpRequest` 的最小替身：记下发出的请求，由用例决定应答。 */
class FakeRequest {
    method = "";
    url = "";
    body: unknown = null;
    responseType = "";
    status = 0;
    responseText = "";
    aborted = false;
    upload: {onprogress: ((event: {loaded: number}) => void) | null} = {onprogress: null};
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    open(method: string, url: string): void {
        this.method = method;
        this.url = url;
    }
    send(body: unknown): void {
        this.body = body;
    }
    abort(): void {
        this.aborted = true;
        this.onabort?.();
    }
    answer(status: number, text: string): void {
        this.status = status;
        this.responseText = text;
        this.onload?.();
    }
}

function clientWith() {
    const requests: FakeRequest[] = [];
    const fetched: Array<{url: string; init: RequestInit | undefined}> = [];
    const client = createFolderUploadClient({
        createRequest: () => {
            const request = new FakeRequest();
            requests.push(request);
            return request as unknown as UploadRequest;
        },
        fetch: ((url: string, init?: RequestInit) => {
            fetched.push({url, init});
            return Promise.resolve(new Response(null, {status: 204}));
        }) as typeof fetch,
    });
    return {client, requests, fetched};
}

describe("上传客户端", () => {
    const folder = folderOf({"package.json": "{}"});

    it("成功：发一个 POST、交回 id 与计数；进度按已发字节与总量回报，不超过总量", async () => {
        const {client, requests} = clientWith();
        const progress: Array<[number, number]> = [];
        const pending = client.upload(folder, {onProgress: (sent, total) => progress.push([sent, total])});
        const request = requests[0]!;
        expect([request.method, request.url]).toEqual(["POST", "/api/nbook.plugins/uploads"]);
        expect(request.body).toBeInstanceOf(Blob);
        request.upload.onprogress?.({loaded: 1});
        request.upload.onprogress?.({loaded: 999_999});
        request.answer(200, JSON.stringify({id: "abc", files: 1, bytes: 12}));
        expect(await pending).toEqual({ok: true, id: "abc", files: 1, bytes: 12});
        expect(progress).toEqual([[1, folder.bytes], [folder.bytes, folder.bytes]]);
    });

    it("失败的三种形状：服务端的 {code, detail}、nb-host 的 {error: {message}}、没有正文的 413；连不上与取消", async () => {
        const answers: Array<[number, string, unknown]> = [
            [400, JSON.stringify({code: "upload-path-invalid", detail: "路径里不能有 .."}), {ok: false, code: "upload-path-invalid", detail: "路径里不能有 .."}],
            [429, JSON.stringify({code: "upload-busy", detail: "稍后再试"}), {ok: false, code: "upload-busy", detail: "稍后再试"}],
            [403, JSON.stringify({error: {code: "origin-not-allowed", message: "不接受来源的写请求。"}}), {ok: false, code: "upload-failed", detail: "不接受来源的写请求。"}],
            [413, "", {ok: false, code: "upload-too-large", detail: ""}],
            [502, "<html>", {ok: false, code: "upload-failed", detail: "HTTP 502"}],
            [200, "不是 JSON", {ok: false, code: "upload-failed", detail: "服务端的应答不对"}],
        ];
        for (const [status, text, expected] of answers) {
            const {client, requests} = clientWith();
            const pending = client.upload(folder);
            requests[0]!.answer(status, text);
            expect(await pending).toEqual(expected);
        }
        const offline = clientWith();
        const pending = offline.client.upload(folder);
        offline.requests[0]!.onerror?.();
        expect(await pending).toEqual({ok: false, code: "unreachable", detail: ""});
        const aborting = clientWith();
        const controller = new AbortController();
        const cancelled = aborting.client.upload(folder, {signal: controller.signal});
        controller.abort();
        expect(await cancelled).toEqual({ok: false, code: "unreachable", detail: "aborted"});
        expect(aborting.requests[0]!.aborted).toBe(true);
    });

    it("删除：DELETE 这个 id（编码后），页面离开时带 keepalive；网络失败不抛", async () => {
        const {client, fetched} = clientWith();
        await client.discard("a/b c");
        await client.discard("id", {keepalive: true});
        expect(fetched.map(({url, init}) => [url, init?.method, init?.keepalive])).toEqual([["/api/nbook.plugins/uploads/a%2Fb%20c", "DELETE", false], ["/api/nbook.plugins/uploads/id", "DELETE", true]]);
        const broken = createFolderUploadClient({fetch: (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch});
        await expect(broken.discard("x")).resolves.toBeUndefined();
    });
});
