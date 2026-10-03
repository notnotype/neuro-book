/**
 * 前端构建产物服务：真实临时目录里的 index.html、带哈希的资源与指向目录外的符号链接。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {openStaticFiles} from "./static";
import type {StaticFiles} from "./static";

let tmp = "";
let files: StaticFiles;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-static", "static-files");
    const root = join(tmp, "web");
    await mkdir(join(root, "assets"), {recursive: true});
    await writeFile(join(root, "index.html"), "<!doctype html><title>shell</title>");
    await writeFile(join(root, "assets", "index-abc123.js"), "console.log(1)");
    await writeFile(join(tmp, "secret.txt"), "outside");
    await symlink(join(tmp, "secret.txt"), join(root, "leak.txt"));
    await symlink(join(tmp, "secret.txt"), join(root, "assets", "leak"));
    files = await openStaticFiles(root);
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const get = (path: string, method = "GET") => files.serve(new Request(`http://127.0.0.1${path}`, {method}));

describe("前端构建产物", () => {
    it("根路径与没有扩展名的页面路径都给外壳，外壳每次重新验证", async () => {
        for (const path of ["/", "/workbench", "/a/b/c"]) {
            const response = await get(path);
            expect(response.status).toBe(200);
            expect(await response.text()).toBe("<!doctype html><title>shell</title>");
            expect(response.headers.get("cache-control")).toBe("no-cache");
            expect(response.headers.get("content-type")).toContain("text/html");
        }
    });

    it("带哈希的资源长期缓存；缺失的资源与带扩展名的路径是 404，不拿外壳顶替", async () => {
        const asset = await get("/assets/index-abc123.js");
        expect(asset.status).toBe(200);
        expect(asset.headers.get("cache-control")).toContain("immutable");
        expect(asset.headers.get("content-type")).toContain("javascript");
        expect(asset.headers.get("x-content-type-options")).toBe("nosniff");
        for (const path of ["/assets/missing-000.js", "/assets/later", "/favicon.ico"]) {
            expect((await get(path)).status).toBe(404);
        }
    });

    it("越出静态根的路径与符号链接都按不存在处理", async () => {
        for (const path of ["/..%2fsecret.txt", "/%2e%2e/secret.txt", "/leak.txt", "/assets/leak", "/a%5c..%5c..%5csecret.txt", "/%E0%A4%A"]) {
            const response = await get(path);
            expect(response.status).toBe(404);
            expect(await response.text()).not.toContain("outside");
        }
    });

    it("HEAD 只给响应头；其它方法是 405", async () => {
        const head = await get("/assets/index-abc123.js", "HEAD");
        expect(head.status).toBe(200);
        expect(head.headers.get("cache-control")).toContain("immutable");
        expect(await head.text()).toBe("");
        const post = await get("/", "POST");
        expect(post.status).toBe(405);
        expect(post.headers.get("allow")).toBe("GET, HEAD");
    });

    it("静态根不存在或缺少 index.html 时拒绝打开", async () => {
        await expect(openStaticFiles(join(tmp, "missing"))).rejects.toThrow("不存在");
        await mkdir(join(tmp, "empty"));
        await expect(openStaticFiles(join(tmp, "empty"))).rejects.toThrow("index.html");
    });
});
