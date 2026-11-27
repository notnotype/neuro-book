/** Lab 里表情包页的样本数据（docs/specs/agent/stickers.md 输出 25 到 27）：契约形状的概要与详情，图是 SVG 数据地址。 */

import type {StickerPackDetail, StickerPackSummary} from "nbook/plugins/stickers/shared/contracts";

import {stickerImage} from "./samples-art";
import type {Face, Sticker} from "./samples-art";

interface Entry {
    readonly name: string;
    readonly file: string;
    readonly face: Face;
    readonly color: string;
    readonly common: boolean;
    readonly description?: string;
    readonly box?: Sticker["box"];
    /** 没加进来 / 认不出 */
    readonly extra?: "unlisted" | "name";
}

interface Sample {
    readonly id: string;
    readonly folder: string;
    readonly title: string;
    readonly description?: string;
    readonly source: "user" | "plugin" | "builtin";
    readonly plugin?: {readonly id: string; readonly title: string | null};
    readonly status?: "ok" | "invalid";
    readonly problem?: string;
    readonly listed: boolean;
    readonly entries: readonly Entry[];
    /** 写法的包段与“被我的同名包盖住”（服务端算好的，见 `browser-catalog.ts` 的 `summaryMarks`）。 */
    readonly writing?: string;
    readonly shadowed?: true;
}

const entry = (name: string, face: Face, color: string, common: boolean, more: Partial<Entry> = {}): Entry => ({name, file: `${name}.png`, face, color, common, ...more});

const LYRA: Sample = {
    id: "user.lyra", folder: "lyra", title: "星璃", description: "星璃的日常表情", source: "user", listed: true, writing: "lyra",
    entries: [
        entry("开心", "smile", "#f9c74f", true, {description: "完成一件事、被夸的时候"}),
        entry("害羞", "blush", "#ffd6a5", true, {description: "被调侃的时候"}),
        entry("困", "sleepy", "#bdb2ff", true),
        entry("比心", "heart", "#ff6b81", true),
        entry("哭哭", "cry", "#a0c4ff", false),
        entry("生气", "angry", "#ff9f80", false),
        entry("我不理解", "card", "#6d8299", false, {box: {width: 320, height: 180, caption: "我不理解"}}),
        entry("晚安", "night", "#9bb1ff", false),
        entry("举牌", "card", "#b5838d", false, {box: {width: 150, height: 240, caption: "收到"}}),
        {...entry("摸摸头", "blush", "#ffc6ff", false), file: "摸摸头.png", extra: "unlisted"},
        {...entry("冲鸭", "smile", "#fdffb6", false), file: "冲鸭.png", extra: "unlisted"},
    ],
};

const CAT: Sample = {
    id: "user.cat", folder: "cat", title: "cat", source: "user", listed: false,
    entries: [
        {...entry("1", "plain", "#a8a29e", true), file: "1.png", extra: "name"},
        entry("困", "cat", "#e9c46a", true),
        entry("开心", "cat", "#f4a261", true),
        entry("喵", "card", "#8d99ae", true, {box: {width: 200, height: 200, caption: "喵"}}),
    ],
};

const MOCHI: Sample = {
    id: "acme.cute.mochi", folder: "mochi", title: "麻薯", description: "圆滚滚的麻薯团子", source: "plugin", plugin: {id: "acme.cute", title: "可爱表情包"}, listed: true,
    entries: ["好耶", "收到", "啊这", "抱抱", "溜了", "加油"].map((name, index) => entry(name, "mochi", ["#fff1e6", "#e2ece9", "#fde2e4", "#dfe7fd", "#f0efeb", "#fad2e1"][index]!, index < 3)),
};

const EMPTY: Sample = {id: "user.empty", folder: "empty", title: "新表情包", source: "user", listed: false, entries: []};

const BROKEN: Sample = {id: "user.broken", folder: "broken", title: "broken", source: "user", status: "invalid", problem: "manifest-invalid", listed: false, entries: []};

const MANY: Sample = {
    id: "user.many", folder: "many", title: "很多很多", description: "上百个表情，网格自己折行", source: "user", listed: true,
    entries: Array.from({length: 60}, (_, index) => entry(`表情${String(index + 1)}`, (["smile", "blush", "sleepy", "heart", "cry", "angry", "what", "night"] as const)[index % 8]!, ["#f9c74f", "#ffd6a5", "#bdb2ff", "#ff6b81", "#a0c4ff", "#ff9f80", "#caffbf", "#9bb1ff"][index % 8]!, index < 12)),
};

/** 内置的同名包：被我的 lyra 盖住，写法要写 id。 */
const BUILTIN_LYRA: Sample = {
    id: "builtin.lyra", folder: "lyra", title: "星璃", description: "应用自带的星璃表情", source: "builtin", listed: true, writing: "builtin.lyra", shadowed: true,
    entries: (["开心", "嘿嘿", "比心", "害羞", "期待", "惊讶"] as const).map((name, index) => entry(name, (["smile", "blush", "heart", "blush", "smile", "what"] as const)[index]!, ["#f9c74f", "#ffd6a5", "#ff6b81", "#ffc6ff", "#caffbf", "#a0c4ff"][index]!, true)),
};

export const SAMPLES: readonly Sample[] = [LYRA, CAT, MOCHI, EMPTY, BROKEN, MANY, BUILTIN_LYRA];

const urlOf = (item: Entry): string => stickerImage({face: item.face, color: item.color, box: item.box});
const proper = (sample: Sample): readonly Entry[] => sample.entries.filter((item) => item.extra === undefined);

export function summaryOf(sample: Sample): StickerPackSummary {
    const first = proper(sample).find((item) => item.common) ?? proper(sample)[0];
    return {
        id: sample.id, folder: sample.folder, source: sample.source, ...(sample.plugin === undefined ? {} : {plugin: sample.plugin}), title: sample.title,
        ...(sample.description === undefined ? {} : {description: sample.description}), ...(sample.writing === undefined ? {} : {writing: sample.writing}), ...(sample.shadowed === undefined ? {} : {shadowed: sample.shadowed}), status: sample.status ?? "ok", ...(sample.problem === undefined ? {} : {problem: sample.problem}),
        count: proper(sample).length, thumbnail: first === undefined ? null : urlOf(first),
        unrecognized: sample.entries.filter((item) => item.extra === "name").length, unlisted: sample.entries.filter((item) => item.extra === "unlisted").length,
    };
}

export function detailOf(sample: Sample): StickerPackDetail {
    return {
        summary: summaryOf(sample),
        listed: sample.listed,
        token: sample.source === "user" ? "token" : null,
        stickers: proper(sample).map((item) => ({name: item.name, file: item.file, ...(item.description === undefined ? {} : {description: item.description}), common: item.common, width: item.box?.width ?? 128, height: item.box?.height ?? 128, bytes: 14336, url: urlOf(item)})),
        extras: sample.entries.filter((item) => item.extra !== undefined).map((item) => ({file: item.file, reason: item.extra!, raw: null, width: 128, height: 128, bytes: 12288, url: urlOf(item)})),
    };
}

export const sampleById = (id: string): Sample | undefined => SAMPLES.find((sample) => sample.id === id);
