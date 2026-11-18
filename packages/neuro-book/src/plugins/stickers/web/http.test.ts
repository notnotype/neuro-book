/**
 * 表情包页的 HTTP 一侧（`http.ts`，docs/specs/agent/stickers.md 输出 29、35、36 的浏览器端）：请求的形状、服务端失败体的解析、
 * 本地文件读不到与连不上服务分开、导出文件名取响应头。fetch 与保存用内存里的替身，响应是真实的 `Response`。
 */

import {describe, expect, test} from "bun:test";

import {downloadName, createStickersHttp} from "./http";

const json = (status: number, body: unknown): Response => Response.json(body, {status});

describe("加图", () => {
    test("PUT 到包与文件名（编码过）；成功交回服务端实际用的文件名；失败交回码与稳定原因", async () => {
        const seen: Array<{url: string; method: string | undefined}> = [];
        const responses = [json(200, {file: "开心-2.png", resized: true}), json(422, {error: {code: "image-rejected", reason: "type-mismatch"}}), json(500, "不是 JSON 对象")];
        const http = createStickersHttp({fetch: (async (url: string, init: RequestInit) => {
            seen.push({url, method: init.method});
            return responses.shift()!;
        }) as never});
        const file = new File([new Uint8Array([1])], "开心 1.png");
        expect(await http.upload("user.cat", file)).toEqual({ok: true, file: "开心-2.png", resized: true});
        expect(seen[0]).toEqual({url: "/api/nbook.stickers/packs/user.cat/images/%E5%BC%80%E5%BF%83%201.png", method: "PUT"});
        expect(await http.upload("user.cat", file)).toEqual({ok: false, code: "image-rejected", reason: "type-mismatch"});
        expect(await http.upload("user.cat", file)).toEqual({ok: false, code: "unavailable"});
    });

    test("读不了本地文件（选定之后被移走）与连不上服务是两种失败", async () => {
        const unreadable = createStickersHttp({fetch: (async () => {
            throw Object.assign(new Error("读不了"), {name: "NotReadableError"});
        }) as never});
        const offline = createStickersHttp({fetch: (async () => {
            throw new TypeError("Failed to fetch");
        }) as never});
        const file = new File([new Uint8Array([1])], "a.png");
        expect(await unreadable.upload("user.cat", file)).toEqual({ok: false, code: "file-unreadable"});
        expect(await unreadable.importZip(file)).toEqual({ok: false, code: "file-unreadable"});
        expect(await offline.upload("user.cat", file)).toEqual({ok: false, code: "unavailable"});
        expect(await offline.importZip(file)).toEqual({ok: false, code: "unavailable"});
    });
});

describe("导入", () => {
    test("查询串带 zip 名、处理方式与令牌；同名冲突交回冲突信息；别的失败交回码与服务端写的原因", async () => {
        const urls: string[] = [];
        const conflict = {existing: {id: "user.cat", title: "猫", count: 1, files: [], token: "t"}, copyAs: "cat-2"};
        const responses = [json(409, {error: {code: "import-conflict"}, conflict}), json(422, {error: {code: "import-invalid", message: "zip 里没有图片"}}), json(200, {id: "user.cat-2"})];
        const http = createStickersHttp({fetch: (async (url: string) => {
            urls.push(url);
            return responses.shift()!;
        }) as never});
        const file = new File([new Uint8Array([1])], "猫 猫.zip");
        expect(await http.importZip(file)).toEqual({ok: false, code: "import-conflict", conflict});
        expect(await http.importZip(file, {mode: "copy"})).toEqual({ok: false, code: "import-invalid", reason: "zip 里没有图片"});
        expect(await http.importZip(file, {mode: "replace", token: "a b"})).toEqual({ok: true, id: "user.cat-2"});
        expect(urls).toEqual([
            "/api/nbook.stickers/import?name=%E7%8C%AB+%E7%8C%AB.zip",
            "/api/nbook.stickers/import?name=%E7%8C%AB+%E7%8C%AB.zip&mode=copy",
            "/api/nbook.stickers/import?name=%E7%8C%AB+%E7%8C%AB.zip&mode=replace&token=a+b",
        ]);
    });
});

describe("导出", () => {
    test("拿到 zip 后交给保存，文件名取响应头；失败交回服务端的码", async () => {
        const saved: Array<{name: string; size: number}> = [];
        const responses = [
            new Response(new Uint8Array([1, 2, 3]), {headers: {"content-disposition": "attachment; filename*=UTF-8''%E7%8C%AB.zip"}}),
            json(422, {error: {code: "export-empty"}}),
        ];
        const http = createStickersHttp({fetch: (async () => responses.shift()!) as never, save: (blob, name) => saved.push({name, size: blob.size})});
        expect(await http.exportPack("user.cat")).toEqual({ok: true});
        expect(saved).toEqual([{name: "猫.zip", size: 3}]);
        expect(await http.exportPack("user.cat")).toEqual({ok: false, code: "export-empty"});
    });

    test("downloadName：响应头没有或编码坏了用备用名", () => {
        expect(downloadName(null, "x.zip")).toBe("x.zip");
        expect(downloadName("attachment; filename*=UTF-8''%E0%A4%A", "x.zip")).toBe("x.zip");
        expect(downloadName("attachment; filename*=UTF-8''a%20b.zip", "x.zip")).toBe("a b.zip");
    });
});
