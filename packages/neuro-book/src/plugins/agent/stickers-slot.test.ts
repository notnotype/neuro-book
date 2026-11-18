/**
 * 提示词里的表情（docs/specs/agent/stickers.md 输出 14–17、验收 1、3）：槽的文字由纯函数算；扩展装进内核的测试会话，表情目录用
 * 真实的 `StickerCatalog`（真实临时目录、`Bun.Image` 现做的图），看请求里的槽与它随目录变不变。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestSession} from "@notnotype/nb-harness/kernel/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {StickerCatalog} from "nbook/plugins/stickers/backend/catalog";
import type {StickerPackEntry} from "nbook/plugins/stickers/shared/contracts";

import {SLOT_CHARS_MAX, SLOT_PACKS_MAX, SLOT_STICKERS_MAX, stickersExtension, stickersSection} from "./backend/stickers/extension";
import {profileAllowlist} from "./shared/profile-allowlist";

const PIXEL = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (char) => char.charCodeAt(0));
const png = (): Promise<Uint8Array> => new Bun.Image(PIXEL).resize(16, 16).png().bytes();

let tmp = "";
let counter = 0;
const cleanups: Array<() => Promise<void>> = [];
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-agent", "stickers-slot");
});
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const pack = (id: string, stickers: Array<{name: string; common?: boolean; description?: string}>, extra: Partial<StickerPackEntry> = {}): StickerPackEntry => ({
    id,
    folder: id.slice(id.lastIndexOf(".") + 1),
    source: "user",
    title: id,
    status: "ok",
    stickers: stickers.map((sticker, index) => ({name: sticker.name, file: `${String(index)}.png`, common: sticker.common ?? true, width: 8, height: 8, version: "1-1", ...(sticker.description === undefined ? {} : {description: sticker.description})})),
    ...extra,
});

describe("槽的文字", () => {
    test("输出 14、16：白名单里有效的表情包按白名单顺序各一段，常用的表情带写法，有说明的带说明；白名单空或都无效时没有内容", () => {
        const packs = [pack("user.lyra", [{name: "开心", description: "被夸的时候"}, {name: "害羞"}], {title: "星璃", description: "星璃的表情"}), pack("user.cat", [{name: "喵"}]), pack("user.broken", [], {status: "invalid"})];
        // 白名单的顺序不是 id 的字母序：段落按白名单排。
        const section = stickersSection(["user.lyra", "user.cat"], packs) ?? "";
        expect(section.indexOf("## 星璃（stickers://user.lyra/）")).toBeLessThan(section.indexOf("## user.cat（stickers://user.cat/）"));
        expect(section).toContain("星璃的表情\n:lyra/开心: — 被夸的时候\n:lyra/害羞:");
        expect(section).not.toContain("还有更多");
        expect(stickersSection([], packs)).toBeNull();
        expect(stickersSection(["user.broken", "user.gone"], packs)).toBeNull();
    });

    test("输出 14、17：写法一律带包；白名单以外的表情包增删不改文字，只有同名文件夹时改写表情包 id", () => {
        const lyra = pack("user.lyra", [{name: "开心"}]);
        const alone = stickersSection(["user.lyra"], [lyra]);
        expect(alone).toContain(":lyra/开心:");
        expect(stickersSection(["user.lyra"], [lyra, pack("user.cat", [{name: "开心"}])])).toBe(alone);
        expect(stickersSection(["user.lyra"], [lyra, pack("acme.cute.lyra", [{name: "开心"}], {source: "plugin"})])).toContain(":user.lyra/开心:");
    });

    test("输出 15：至多 8 个表情包、60 个常用表情、6000 个字符，不常用的不列，有没列的就末尾写一句", () => {
        const many = Array.from({length: SLOT_PACKS_MAX + 2}, (_, index) => pack(`user.p${String(index)}`, [{name: "a"}]));
        const capped = stickersSection(many.map((entry) => entry.id), many) ?? "";
        expect(capped.match(/^## /gmu)).toHaveLength(SLOT_PACKS_MAX);
        expect(capped).toContain("还有更多，见 stickers://");
        const big = [pack("user.big", Array.from({length: SLOT_STICKERS_MAX + 5}, (_, index) => ({name: `s${String(index)}`})))];
        expect((stickersSection(["user.big"], big) ?? "").match(/^:big\//gmu)).toHaveLength(SLOT_STICKERS_MAX);
        expect(stickersSection(["user.x"], [pack("user.x", [{name: "a"}, {name: "b", common: false}])])).toContain("还有更多");
        const long = Array.from({length: SLOT_PACKS_MAX}, (_, index) => pack(`user.l${String(index)}`, Array.from({length: 7}, (_, inner) => ({name: `n${String(inner)}`, description: "长".repeat(150)}))));
        expect((stickersSection(long.map((entry) => entry.id), long) ?? "").length).toBeLessThanOrEqual(SLOT_CHARS_MAX);
    });
});

describe("请求里的槽", () => {
    test("验收 1、3：白名单里的表情包进请求；另放一个同名表情的表情包，槽的文字不变；Profile 设置去掉后槽没了", async () => {
        counter += 1;
        const user = join(tmp, `u${String(counter)}`);
        await mkdir(join(user, "lyra"), {recursive: true});
        await writeFile(join(user, "lyra", "stickers.json"), JSON.stringify({title: "星璃", stickers: [{name: "开心", file: "a.png", description: "被夸的时候", common: true}, {name: "害羞", file: "a.png", common: true}, {name: "比心", file: "a.png"}]}));
        await writeFile(join(user, "lyra", "a.png"), await png());
        const catalog = await StickerCatalog.open({roots: [{key: "user", source: "user", prefix: "user", root: user, watch: false}], clock: {now: () => 0, schedule: () => () => undefined} as never, report: () => undefined});
        cleanups.push(() => catalog.close());
        let binding: {added: string[]; removed: string[]} = {added: ["user.lyra"], removed: []};
        const allowed = () => profileAllowlist(undefined, binding, catalog.list().map((entry) => entry.id));
        const session = await createTestSession({extensions: [stickersExtension({stickers: catalog, allowed})]});
        cleanups.push(() => session.close());
        /** 这次请求系统块里的文字（稳定的槽在那里）。 */
        const systemText = (index: number): string => {
            const request = session.requests[index];
            if (request === undefined) throw new Error(`没有第 ${String(index + 1)} 次请求`);
            return JSON.stringify(request.raw.system);
        };
        session.model.script("好");
        await session.say("你好");
        expect(session.requests[0]?.outline()[0]).toContain("slot:stickers@nbook.agent.stickers");
        const first = systemText(0);
        expect(first).toContain(":lyra/开心: — 被夸的时候");
        expect(first).not.toContain("比心");

        await mkdir(join(user, "cat"));
        await writeFile(join(user, "cat", "stickers.json"), JSON.stringify({stickers: [{name: "开心", file: "a.png", common: true}]}));
        await writeFile(join(user, "cat", "a.png"), await png());
        await catalog.addRoot({key: "user", source: "user", prefix: "user", root: user, watch: false});
        session.model.script("好");
        await session.say("再来");
        expect(systemText(1)).toBe(first);

        binding = {added: ["user.lyra"], removed: ["user.lyra"]};
        session.model.script("好");
        await session.say("最后");
        expect(session.requests[2]?.outline()[0]).not.toContain("slot:stickers");
    });
});
