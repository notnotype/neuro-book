/** 浏览器一侧查表情（docs/specs/agent/stickers.md 输出 7–9 与“时序与寿命”）：带包、不带包、重名，目录晚到与取不到。 */
import {describe, expect, test} from "bun:test";

import {parseSticker} from "@notnotype/nb-markdown";
import type {StickerRef} from "@notnotype/nb-markdown";

import type {BrowserStickerPack} from "../shared/contracts";
import {createStickerDirectory, findSticker} from "./resolver";

const sticker = (name: string, url = `/${name}`) => ({name, width: 8, height: 8, url});
const PACKS: BrowserStickerPack[] = [
    // 包段是服务端按输出 14 算好的：我的 lyra 盖住插件的 lyra。
    {id: "user.lyra", folder: "lyra", title: "lyra", source: "user", writing: "lyra", stickers: [sticker("开心", "/lyra/happy"), sticker("害羞")]},
    {id: "acme.cute.lyra", folder: "lyra", title: "lyra", source: "plugin", plugin: {id: "acme.cute", title: null}, writing: "acme.cute.lyra", stickers: [sticker("开心", "/acme/happy"), sticker("挥手")]},
    {id: "user.cat", folder: "cat", title: "cat", source: "user", writing: "cat", stickers: [sticker("喵")]},
    // 两个插件同名、同一级：都写 id。
    {id: "acme.cute.dog", folder: "dog", title: "dog", source: "plugin", plugin: {id: "acme.cute", title: null}, writing: "acme.cute.dog", stickers: [sticker("汪", "/acme/wang"), sticker("摇尾")]},
    {id: "zoo.dog", folder: "dog", title: "dog", source: "plugin", plugin: {id: "zoo", title: null}, writing: "zoo.dog", stickers: [sticker("汪", "/zoo/wang")]},
    // 我的 fox 没有表情、不在浏览器目录里，内置的 fox 照样被它盖住、写 id。
    {id: "builtin.fox", folder: "fox", title: "fox", source: "builtin", writing: "builtin.fox", stickers: [sticker("狐", "/builtin/fox")]},
    // 内置的两个包同名表情：同一级不止一个。
    {id: "builtin.lyra-chibi", folder: "lyra-chibi", title: "chibi", source: "builtin", writing: "lyra-chibi", stickers: [sticker("挥手", "/chibi/wave"), sticker("困", "/chibi/sleepy")]},
    {id: "builtin.lyra", folder: "lyra", title: "lyra", source: "builtin", writing: "builtin.lyra", stickers: [sticker("困", "/builtin/sleepy")]},
];
const ref = (raw: string): StickerRef => {
    const parsed = parseSticker(raw);
    if (parsed === null) throw new Error(`不是写法：${raw}`);
    return parsed;
};

describe("找表情", () => {
    test("输出 7：带包时先按 id，再按文件夹名；按文件夹名只认服务端分级胜出的那个（包段等于它），同一级重名、胜出的不在目录里都认不出", () => {
        expect(findSticker(PACKS, ref(":user.lyra/开心:"))?.url).toBe("/lyra/happy");
        expect(findSticker(PACKS, ref(":acme.cute.lyra/开心:"))?.url).toBe("/acme/happy");
        expect(findSticker(PACKS, ref(":builtin.lyra/困:"))?.url).toBe("/builtin/sleepy");
        expect(findSticker(PACKS, ref(":cat/喵:"))?.url).toBe("/喵");
        // 我的优先：lyra 是我的那个，插件的“挥手”经 lyra 认不到。
        expect(findSticker(PACKS, ref(":lyra/开心:"))).toMatchObject({url: "/lyra/happy", pack: "user.lyra"});
        expect(findSticker(PACKS, ref(":lyra/挥手:"))).toBeNull();
        expect(findSticker(PACKS, ref(":dog/汪:"))).toBeNull();
        expect(findSticker(PACKS, ref(":fox/狐:"))).toBeNull();
        expect(findSticker(PACKS, ref(":cat/开心:"))).toBeNull();
    });

    test("输出 8：不带包时在有这个名字的包里取最高的一级，这一级恰好一个才认得出", () => {
        expect(findSticker(PACKS, ref(":害羞:"))?.url).toBe("/害羞");
        // 我的与插件都有“开心”：我的那个。插件与内置都有“挥手”：插件的那个。
        expect(findSticker(PACKS, ref(":开心:"))?.url).toBe("/lyra/happy");
        expect(findSticker(PACKS, ref(":挥手:"))?.url).toBe("/挥手");
        // 两个插件都有“汪”、两个内置包都有“困”：同一级不止一个。
        expect(findSticker(PACKS, ref(":汪:"))).toBeNull();
        expect(findSticker(PACKS, ref(":困:"))).toBeNull();
        expect(findSticker(PACKS, ref(":没有:"))).toBeNull();
    });
});

describe("目录的时序", () => {
    test("目录到之前的查询等着，到了按它回答；之后换目录按新的回答", async () => {
        const directory = createStickerDirectory();
        const signal = new AbortController().signal;
        const pending = directory.resolve(ref(":喵:"), signal);
        directory.set(PACKS);
        // 带上认到的表情包 id 与显示名：按贴纸显示按 id 选中、预览的标题写显示名（输出 46、47）。
        expect(await pending).toMatchObject({url: "/喵", width: 8, height: 8, pack: "user.cat", packTitle: "cat"});
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
