/** 浏览器一侧查表情（docs/specs/agent/stickers.md 输出 7–9 与“时序与寿命”）：带包、不带包、重名，目录晚到与取不到。 */
import {describe, expect, test} from "bun:test";

import {parseSticker} from "@notnotype/nb-markdown";
import type {StickerRef} from "@notnotype/nb-markdown";

import type {BrowserStickerPack} from "../shared/contracts";
import {createStickerDirectory, findSticker} from "./resolver";

const sticker = (name: string, url = `/${name}`) => ({name, width: 8, height: 8, url});
const PACKS: BrowserStickerPack[] = [
    {id: "user.lyra", folder: "lyra", title: "lyra", source: "user", writing: "user.lyra", stickers: [sticker("开心", "/lyra/happy"), sticker("害羞")]},
    {id: "acme.cute.lyra", folder: "lyra", title: "lyra", source: "plugin", plugin: {id: "acme.cute", title: null}, writing: "acme.cute.lyra", stickers: [sticker("开心", "/acme/happy")]},
    {id: "user.cat", folder: "cat", title: "cat", source: "user", writing: "cat", stickers: [sticker("喵")]},
];
const ref = (raw: string): StickerRef => {
    const parsed = parseSticker(raw);
    if (parsed === null) throw new Error(`不是写法：${raw}`);
    return parsed;
};

describe("找表情", () => {
    test("输出 7：带包时先按 id，再按文件夹名；文件夹名不止一个是认不出", () => {
        expect(findSticker(PACKS, ref(":user.lyra/开心:"))?.url).toBe("/lyra/happy");
        expect(findSticker(PACKS, ref(":acme.cute.lyra/开心:"))?.url).toBe("/acme/happy");
        expect(findSticker(PACKS, ref(":cat/喵:"))?.url).toBe("/喵");
        expect(findSticker(PACKS, ref(":lyra/害羞:"))).toBeNull();
        expect(findSticker(PACKS, ref(":cat/开心:"))).toBeNull();
    });

    test("输出 8：不带包时在全部表情包里恰好一个才认得出", () => {
        expect(findSticker(PACKS, ref(":害羞:"))?.url).toBe("/害羞");
        expect(findSticker(PACKS, ref(":开心:"))).toBeNull();
        expect(findSticker(PACKS, ref(":没有:"))).toBeNull();
    });
});

describe("目录的时序", () => {
    test("目录到之前的查询等着，到了按它回答；之后换目录按新的回答", async () => {
        const directory = createStickerDirectory();
        const signal = new AbortController().signal;
        const pending = directory.resolve(ref(":喵:"), signal);
        directory.set(PACKS);
        expect(await pending).toMatchObject({url: "/喵", width: 8, height: 8});
        directory.set([]);
        expect(await directory.resolve(ref(":喵:"), signal)).toBeNull();
    });

    test("还没取到过就失败：等着的与之后的都认不出；取到过再失败的留着旧目录", async () => {
        const directory = createStickerDirectory();
        const signal = new AbortController().signal;
        const pending = directory.resolve(ref(":喵:"), signal);
        directory.failed();
        expect(await pending).toBeNull();
        const kept = createStickerDirectory();
        kept.set(PACKS);
        kept.failed();
        expect(await kept.resolve(ref(":喵:"), signal)).toMatchObject({url: "/喵"});
    });
});
