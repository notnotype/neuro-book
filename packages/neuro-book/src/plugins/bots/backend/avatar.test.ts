/**
 * 头像路由（docs/specs/bots/bots.md 的头像）：真实文件与真实的 Hono 路由，`app.request` 发请求。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {copyFile, mkdir, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createAvatarRoutes} from "./avatar";
import {locateBuiltinBots} from "./builtin-root";

let tmp = "";
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-bots", "avatar");
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("头像路由", () => {
    test("只给记录里有的 bot：按字节判类型、带 ETag 与 no-cache，同一个 ETag 回 304；没有、不合规则、链接、不是图片、跨站的都不给", async () => {
        const root = join(tmp, "bots");
        for (const id of ["lyra", "nova", "vega", "ghost"]) await mkdir(join(root, id), {recursive: true});
        await copyFile(join(locateBuiltinBots()!, "lyra", "avatar.webp"), join(root, "lyra", "avatar.webp"));
        await writeFile(join(tmp, "outside.webp"), "外面的文件");
        await symlink(join(tmp, "outside.webp"), join(root, "nova", "avatar.webp"));
        await writeFile(join(root, "vega", "avatar.png"), "不是图片");
        await copyFile(join(locateBuiltinBots()!, "lyra", "avatar.webp"), join(root, "ghost", "avatar.webp"));
        const app = createAvatarRoutes({root, known: (id) => ["lyra", "nova", "vega"].includes(id)});

        const ok = await app.request("/avatar/lyra");
        expect(ok.status).toBe(200);
        expect(ok.headers.get("content-type")).toBe("image/webp");
        expect(ok.headers.get("cache-control")).toBe("no-cache");
        expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
        const etag = ok.headers.get("etag")!;
        expect((await ok.arrayBuffer()).byteLength).toBeGreaterThan(0);
        expect((await app.request("/avatar/lyra", {headers: {"if-none-match": etag}})).status).toBe(304);

        // ghost 有头像文件，但记录里没有它（目录在、记录不在的不登记）。
        for (const id of ["ghost", "nope", "LYRA", "nova", "vega"]) expect([id, (await app.request(`/avatar/${id}`)).status]).toEqual([id, 404]);
        expect((await app.request("/avatar/lyra", {headers: {"sec-fetch-site": "cross-site"}})).status).toBe(403);
    });
});
