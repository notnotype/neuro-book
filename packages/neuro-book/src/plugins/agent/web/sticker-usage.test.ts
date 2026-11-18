/**
 * 哪些 Profile 明确选了某个表情包（docs/specs/agent/stickers.md 输出 33）：声明的数组、用户加的算，声明“全部”的、去掉了的、后台的不算。
 */

import {describe, expect, test} from "bun:test";

import type {ProfileEntry} from "../shared/contracts";
import {profilesUsingSticker} from "./sticker-usage";

const profile = (key: string, name: string, extra: Partial<Pick<ProfileEntry, "stickers" | "hidden">> = {}): Pick<ProfileEntry, "key" | "name" | "stickers" | "hidden"> => ({key, name, ...extra});

describe("选了这个表情包的 Profile", () => {
    const entries = [
        profile("plot.qa", "剧情问答", {stickers: {allowed: ["user.lyra"]}}),
        profile("nbook.agent.main", "主创", {stickers: {allowed: "all"}}),
        profile("user.lore", "设定核对"),
        profile("user.removed", "去掉了", {stickers: {allowed: ["user.lyra"]}}),
        profile("nbook.agent.session-title", "标题", {hidden: true, stickers: {allowed: ["user.lyra"]}}),
        profile("user.other", "别的包", {stickers: {allowed: ["user.cat"]}}),
    ];
    const settings = {"user.lore": {stickers: {added: ["user.lyra"]}}, "user.removed": {stickers: {removed: ["user.lyra"]}}};

    test("声明的数组里有它、用户加了它的列出，按名字排；声明“全部”的、用户去掉的、后台的、没选它的不列", () => {
        expect(profilesUsingSticker(entries, settings, "user.lyra")).toEqual(["剧情问答", "设定核对"]);
    });

    test("没有 Profile 选它时是空数组", () => {
        expect(profilesUsingSticker(entries, settings, "user.none")).toEqual([]);
    });
});
