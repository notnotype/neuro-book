/**
 * 选择器与补全的数据（docs/specs/agent/stickers.md 输出 39 到 43）：分组顺序、搜索（名字、拼音首字母、包段）、认写法、最近用过。
 * 拼音用真的 `pinyin-pro`，与服务里同一个做法。
 */

import {describe, expect, test} from "bun:test";
import {pinyin} from "pinyin-pro";

import type {BrowserStickerPack} from "../shared/contracts";
import {knownWriting, pickerGroups, pinyinInitials, RECENT_MAX, recentItems, searchStickers, withUsed} from "./picker";

const sticker = (name: string) => ({name, width: 128, height: 128, url: `/img/${name}`});

const PACKS: BrowserStickerPack[] = [
    {id: "acme.dogs.dog", folder: "dog", title: "小狗", source: "plugin", plugin: {id: "acme.dogs", title: "汪汪"}, writing: "dog", stickers: [sticker("开心"), sticker("握手")]},
    {id: "alpha.cats.lyra", folder: "lyra", title: "星璃（插件）", source: "plugin", plugin: {id: "alpha.cats", title: "阿尔法"}, writing: "alpha.cats.lyra", stickers: [sticker("挥手")]},
    {id: "user.lyra", folder: "lyra", title: "星璃", source: "user", writing: "user.lyra", stickers: [sticker("开心"), sticker("困"), sticker("看看"), sticker("happy")]},
    {id: "user.cat", folder: "cat", title: "猫猫", source: "user", writing: "cat", stickers: [sticker("困"), sticker("开饭")]},
];
const initials = pinyinInitials(pinyin);
const groups = pickerGroups(PACKS);
const raws = (items: readonly {raw: string}[]): string[] => items.map((item) => item.raw);

describe("输出 39：分组", () => {
    test("我的在前（目录顺序），插件按插件显示名的码元顺序排（同表情包页）；组头带插件名", () => {
        expect(groups.map((group) => [group.id, group.plugin])).toEqual([["user.lyra", null], ["user.cat", null], ["acme.dogs.dog", "汪汪"], ["alpha.cats.lyra", "阿尔法"]]);
    });

    test("插入的写法用目录给的包段（输出 41）：同名文件夹时是 id", () => {
        expect(raws(groups[0]?.items ?? []).slice(0, 2)).toEqual([":user.lyra/开心:", ":user.lyra/困:"]);
        expect(groups[1]?.items[0]?.raw).toBe(":cat/困:");
    });
});

describe("输出 40：搜索", () => {
    test("名字以查询开头的在前，其余按分组顺序；拼音首字母开头也算", () => {
        expect(raws(searchStickers(groups, PACKS, "开", 8, initials))).toEqual([":user.lyra/开心:", ":cat/开饭:", ":dog/开心:"]);
        expect(raws(searchStickers(groups, PACKS, "kx", 8, initials))).toEqual([":user.lyra/开心:", ":dog/开心:"]);
        expect(raws(searchStickers(groups, PACKS, "k", 8, initials))).toEqual([":user.lyra/开心:", ":user.lyra/困:", ":user.lyra/看看:", ":cat/困:", ":cat/开饭:", ":dog/开心:"]);
    });

    test("拼音库没到时只按名字；拉丁字母不分大小写", () => {
        expect(raws(searchStickers(groups, PACKS, "kx", 8, null))).toEqual([]);
        expect(raws(searchStickers(groups, PACKS, "HAP", 8, null))).toEqual([":user.lyra/happy:"]);
    });

    test("至多 limit 项", () => {
        expect(searchStickers(groups, PACKS, "k", 2, initials)).toHaveLength(2);
    });

    test("`包/查询` 只在包段（文件夹名、id 或显示名）开头相符的包里找；`包/` 后面没字时列全部、不受 limit", () => {
        expect(raws(searchStickers(groups, PACKS, "cat/k", 8, initials))).toEqual([":cat/困:", ":cat/开饭:"]);
        expect(raws(searchStickers(groups, PACKS, "user.l/开", 8, initials))).toEqual([":user.lyra/开心:"]);
        expect(raws(searchStickers(groups, PACKS, "小狗/", 1, initials))).toEqual([":dog/开心:", ":dog/握手:"]);
        expect(raws(searchStickers(groups, PACKS, "lyra/", 1, initials))).toEqual([":user.lyra/开心:", ":user.lyra/困:", ":user.lyra/看看:", ":user.lyra/happy:", ":alpha.cats.lyra/挥手:"]);
        expect(searchStickers(groups, PACKS, "nope/", 8, initials)).toEqual([]);
    });
});

test("认写法：目录里有的为真，认不出与不是写法的为假", () => {
    expect(knownWriting(PACKS, ":cat/开饭:")).toBe(true);
    expect(knownWriting(PACKS, ":握手:")).toBe(true);
    // 两个包都有“开心”，不带包认不出（输出 8）。
    expect(knownWriting(PACKS, ":开心:")).toBe(false);
    expect(knownWriting(PACKS, ":string:")).toBe(false);
    expect(knownWriting(PACKS, "开饭")).toBe(false);
});

describe("输出 43：最近用过", () => {
    test("新的在前、不重复、至多 16 个", () => {
        let recent = [{pack: "user.cat", name: "困"}, {pack: "user.lyra", name: "开心"}];
        recent = withUsed(recent, {pack: "user.lyra", name: "开心"});
        expect(recent).toEqual([{pack: "user.lyra", name: "开心"}, {pack: "user.cat", name: "困"}]);
        for (let index = 0; index < 20; index += 1) recent = withUsed(recent, {pack: "user.x", name: `n${String(index)}`});
        expect(recent).toHaveLength(RECENT_MAX);
        expect(recent[0]).toEqual({pack: "user.x", name: "n19"});
    });

    test("换成目录里的表情；目录里已经没有的不列", () => {
        expect(raws(recentItems(groups, [{pack: "user.cat", name: "开饭"}, {pack: "user.gone", name: "开心"}, {pack: "user.lyra", name: "没有"}, {pack: "acme.dogs.dog", name: "握手"}]))).toEqual([":cat/开饭:", ":dog/握手:"]);
    });
});
