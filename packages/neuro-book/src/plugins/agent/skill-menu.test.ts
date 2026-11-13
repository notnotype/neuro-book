/**
 * 输入框的 `$` 菜单与点开 Skill 标签（docs/specs/agent/skills.md 输出 26、28）。插入的文字经编辑器同一套分词读回，核对认出的名字。
 */

import {describe, expect, test} from "bun:test";

import {promptSkillTokens} from "@notnotype/nb-markdown/prompt-text";

import type {SkillEntry} from "./shared/skills";
import {OPEN_PROFILE_SETTINGS_ITEM, skillAddress, skillMenu} from "./web/skills";

const TEXTS = {title: "Skill", recentGroup: "最近用过", allGroup: "全部", noMatch: "没有匹配的 Skill", openSettings: "打开 Profile 设置", noSkills: "这个 Profile 还没有可用的 Skill", needsInit: "未初始化", initializing: "正在初始化"};

const entry = (source: SkillEntry["source"], name: string, extra: Partial<SkillEntry> = {}): SkillEntry => ({
    id: `${source}.${name}`, name, description: `${name} 的说明`, source, location: `skills://${source}.${name}/SKILL.md`, status: "ready", ...extra,
});

const ENTRIES: readonly SkillEntry[] = [
    entry("user", "style-guide"),
    entry("user", "epub-export", {status: "needs-init"}),
    entry("user", "tts-preview", {status: "initializing"}),
    entry("user", "outline", {status: "invalid"}),
    entry("user", "review"),
    entry("builtin", "review"),
    entry("builtin", "chapter-summary"),
    entry("user", "1st-draft"),
];
const ALL = ENTRIES.map((item) => item.id);

const menu = (query: string, options: {readonly allowed?: readonly string[]; readonly recent?: readonly string[]; readonly entries?: readonly SkillEntry[] | null} = {}) =>
    skillMenu(query, {entries: options.entries === undefined ? ENTRIES : options.entries, allowed: options.allowed ?? ALL, recent: options.recent ?? [], texts: TEXTS});

describe("$ 菜单（输出 26）", () => {
    test("只列白名单里、不是无效的；按名字排，同名的显示 id；未初始化与正在初始化各带状态图标", () => {
        const {items} = menu("");
        expect(items.map((item) => item.label)).toEqual(["1st-draft", "chapter-summary", "epub-export", "builtin.review", "user.review", "style-guide", "tts-preview"]);
        expect(items.find((item) => item.id === "user.epub-export")?.status).toEqual({label: "未初始化", iconClass: "i-lucide-download", tone: "warning"});
        expect(items.find((item) => item.id === "user.tts-preview")?.status).toEqual({label: "正在初始化", busy: true});
        expect(items.find((item) => item.id === "user.style-guide")?.status).toBeUndefined();
        expect(menu("", {allowed: ["user.style-guide", "user.outline"]}).items.map((item) => item.id)).toEqual(["user.style-guide"]);
    });

    test("插入的标签分词读回同一个 Skill：能写 `$名字` 就这样写，重名与数字开头的写花括号", () => {
        const inserted = (id: string) => menu("").items.find((item) => item.id === id)!.insertText;
        expect(inserted("user.style-guide")).toBe("$style-guide");
        expect(promptSkillTokens(`用 ${inserted("user.review")} 审`)).toEqual(["user.review"]);
        expect(promptSkillTokens(`用 ${inserted("builtin.review")} 审`)).toEqual(["builtin.review"]);
        expect(promptSkillTokens(`用 ${inserted("user.1st-draft")} 写`)).toEqual(["1st-draft"]);
    });

    test("最近用过的在前：没有查询词时分“最近用过”“全部”两组，有查询词时不分组、照样排在前面", () => {
        const recent = ["user.tts-preview", "user.style-guide"];
        const grouped = menu("", {recent}).items;
        expect(grouped.slice(0, 2).map((item) => [item.id, item.group])).toEqual([["user.tts-preview", "最近用过"], ["user.style-guide", "最近用过"]]);
        expect(grouped[2]).toMatchObject({id: "user.1st-draft", group: "全部"});
        expect(grouped.filter((item) => item.id === "user.style-guide")).toHaveLength(1);

        const searched = menu("e", {recent}).items;
        expect(searched.every((item) => item.group === undefined)).toBe(true);
        expect(searched[0]?.id).toBe("user.tts-preview");
        // 不分大小写、按包含匹配：tts-preview 里也有 review。
        expect(menu("REVIEW").items.map((item) => item.id)).toEqual(["builtin.review", "user.review", "user.tts-preview"]);
    });

    test("没取到目录时加载中；白名单为空时只有“打开 Profile 设置”一项，选它不插入文字；查不到时写没有匹配", () => {
        expect(menu("", {entries: null})).toMatchObject({items: [], loading: true});
        expect(menu("", {allowed: []}).items).toEqual([{id: OPEN_PROFILE_SETTINGS_ITEM, label: "打开 Profile 设置", description: "这个 Profile 还没有可用的 Skill", iconClass: "i-lucide-settings", insertText: "", continues: true}]);
        expect(menu("zzz")).toMatchObject({items: [], emptyText: "没有匹配的 Skill"});
    });
});

describe("点开 Skill 标签（输出 28）", () => {
    test("按名字现认：用户的打开 user://skills/ 下的 SKILL.md，内置的打开 skills://；按 id 写的同样认", () => {
        expect(skillAddress("style-guide", ENTRIES, ALL)).toBe("user://skills/style-guide/SKILL.md");
        expect(skillAddress("chapter-summary", ENTRIES, ALL)).toBe("skills://builtin.chapter-summary/SKILL.md");
        expect(skillAddress("user.review", ENTRIES, ALL)).toBe("user://skills/review/SKILL.md");
    });

    test("认不到交回 null：不在目录里、不在白名单里、重名、无效", () => {
        expect(skillAddress("gone", ENTRIES, ALL)).toBeNull();
        expect(skillAddress("style-guide", ENTRIES, ["user.review"])).toBeNull();
        expect(skillAddress("review", ENTRIES, ALL)).toBeNull();
        expect(skillAddress("outline", ENTRIES, ALL)).toBeNull();
        expect(skillAddress("review", ENTRIES, ["builtin.review"])).toBe("skills://builtin.review/SKILL.md");
    });
});
