/**
 * 清单的形状核对与没有表情列表时由文件名得出表情（docs/specs/agent/stickers.md 的“输入与前置条件”、输出 2、4）。纯函数，
 * 文件与图片的核对在 `stickers.test.ts` 里用真实目录测。
 */

import {describe, expect, test} from "bun:test";

import {STICKERS_PER_PACK_MAX} from "./contracts";
import {parseManifest, stickersFromFiles} from "./manifest";

const names = (result: ReturnType<typeof stickersFromFiles>): string[] => result.items.flatMap((item) => (item.ok ? [item.sticker.name] : []));

describe("清单", () => {
    test("没写 stickers 是没有表情列表；写了但不是数组的清单无效", () => {
        expect(parseManifest({title: "猫"})).toMatchObject({ok: true, title: "猫", stickers: null});
        expect(parseManifest({stickers: null})).toEqual({ok: false, detail: "stickers 写了但不是数组"});
        expect(parseManifest({stickers: "开心.png"})).toEqual({ok: false, detail: "stickers 写了但不是数组"});
    });

    test("表情不写 name 时取文件名，按同一条名字规则核对；description 是可选的说明", () => {
        const parsed = parseManifest({stickers: [{file: "开心.PNG", description: "被夸的时候"}, {file: "1.png"}, {name: "开心", file: "a.png"}]});
        if (!parsed.ok || parsed.stickers === null) throw new Error("清单应当有效且有列表");
        expect(parsed.stickers.items).toEqual([
            {ok: true, sticker: {name: "开心", file: "开心.PNG", description: "被夸的时候", common: false}},
            {ok: false, label: "第 2 项", reason: expect.stringMatching(/^文件名 1 当不了表情名（/u), named: {file: "1.png", raw: null}},
            {ok: false, label: "第 3 项", reason: "名字 开心 与前面的表情重名", named: {file: "a.png", raw: "开心"}},
        ]);
        // 清单各项写了的文件（含不合规的项），有表情列表时用来找没列的图。
        expect([...parsed.stickers.referenced].sort()).toEqual(["1.png", "a.png", "开心.PNG"]);
    });
});

describe("由文件名得出表情", () => {
    test("只取扩展名是图片、不以点开头的文件，按码元顺序，都算常用", () => {
        const result = stickersFromFiles(["困.webp", "readme.txt", ".hidden.png", "开心.png", "a.JPG", "stickers.json"]);
        expect(result.items).toEqual([
            {ok: true, sticker: {name: "a", file: "a.JPG", common: true}},
            {ok: true, sticker: {name: "困", file: "困.webp", common: true}},
            {ok: true, sticker: {name: "开心", file: "开心.png", common: true}},
        ]);
        expect(result.truncated).toBe(0);
    });

    test("名字规范化到 NFC 后比较：两种写法的同一个字算重名，后到的隔离", () => {
        const result = stickersFromFiles(["café.png", "café.gif"]);
        expect(names(result)).toEqual(["café"]);
        expect(result.items.filter((item) => !item.ok)).toHaveLength(1);
    });

    test("超过 500 张只认按顺序的前 500 张，交回没认的张数", () => {
        const files = Array.from({length: STICKERS_PER_PACK_MAX + 2}, (_, index) => `s${String(index).padStart(3, "0")}.png`);
        const result = stickersFromFiles(files.toReversed());
        expect(result.items).toHaveLength(STICKERS_PER_PACK_MAX);
        expect(names(result).at(-1)).toBe("s499");
        expect(result.truncated).toBe(2);
    });
});
