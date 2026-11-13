/**
 * 设置里的“Skill”页（docs/specs/agent/skills.md 输出 25）：分组与先后、第二行的原因、徽标只在不可用时出现、“初始化”只给未初始化的、
 * 展开的详情、没有 Skill 与读取中。几行的零件对齐靠子网格，在 Lab 的截图里看。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText} from "nbook/shared/testing/text-port";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import type {SkillEntry} from "../shared/skills";
import SkillsSettingsPage from "./components/SkillsSettingsPage.vue";
import {skillFileAddress} from "./skills-page";
import {agentCatalogs} from "./text";

const cleanup: Array<() => void> = [];
afterEach(() => {
    for (const dispose of cleanup.splice(0)) dispose();
    document.body.innerHTML = "";
});

const entry = (source: SkillEntry["source"], name: string, extra: Partial<SkillEntry> = {}): SkillEntry => ({
    id: `${source}.${name}`, name, description: `${name} 的说明`, source, location: `skills://${source}.${name}/SKILL.md`, status: "ready", ...extra,
});

const ENTRIES: readonly SkillEntry[] = [
    entry("builtin", "chapter-summary"),
    entry("user", "style-guide", {license: "MIT", metadata: {author: "林默", version: "0.3"}}),
    entry("user", "epub-export", {status: "needs-init"}),
    entry("user", "lore-check", {status: "needs-init", problem: {code: "install-failed", detail: "error: ETIMEDOUT"}}),
    entry("user", "tts-preview", {status: "initializing"}),
    entry("user", "outline", {status: "invalid", description: "", problem: {code: "name-mismatch", name: "outline-helper"}}),
    entry("user", "drafts", {status: "invalid", description: "", problem: {code: "skill-md-missing"}}),
    entry("user", "voice-check", {external: {python: true, uvMissing: true, compatibility: "需要 Python 3.11"}}),
];

async function show(entries: readonly SkillEntry[] | null) {
    const text = createHostTextEngine({locale: "zh-CN", strict: true});
    text.register("nbook.agent", agentCatalogs.catalogs, agentCatalogs.source);
    const wrapper = mount(SkillsSettingsPage, {props: {entries}, attachTo: document.body, global: {provide: provideText(text.port)}});
    cleanup.push(() => wrapper.unmount());
    await flushPromises();
    // 这里 `wrapper.element` 推不出元素类型（是 any），按页面根元素取。
    const root = wrapper.element as HTMLElement;
    const row = (id: string) => root.querySelector<HTMLElement>(`[data-skill="${id}"]`)!;
    return {wrapper, root, row};
}

describe("SkillsSettingsPage", () => {
    it("我的在前、内置在后；第二行写说明，无效的与上次没装好的写原因；徽标只在不可用时出现；“初始化”只给未初始化的", async () => {
        const {wrapper, root, row} = await show(ENTRIES);
        expect([...root.querySelectorAll("[data-skills-group]")].map((group) => group.getAttribute("data-skills-group"))).toEqual(["user", "builtin"]);
        expect(row("user.style-guide").querySelector("[data-skill-status]")).toBeNull();
        expect(row("user.style-guide").textContent).toContain("style-guide 的说明");
        expect(row("user.epub-export").querySelector("[data-skill-status]")?.textContent?.trim()).toBe("未初始化");
        expect(row("user.lore-check").textContent).toContain("上次初始化没有成功");
        expect(row("user.tts-preview").querySelector("[data-skill-status]")?.textContent?.trim()).toBe("正在初始化");
        expect(row("user.outline").textContent).toContain("SKILL.md 里的 name 是 outline-helper，与文件夹名不同");
        expect(row("user.outline").querySelector("[data-skill-status]")?.textContent?.trim()).toBe("无效");
        expect(ENTRIES.filter((item) => row(item.id).querySelector("[data-skill-init]") !== null).map((item) => item.id)).toEqual(["user.epub-export", "user.lore-check"]);

        row("user.epub-export").querySelector<HTMLButtonElement>("[data-skill-init]")!.click();
        row("user.style-guide").querySelector<HTMLButtonElement>("[data-skill-open]")!.click();
        root.querySelector<HTMLButtonElement>("[data-skills-open-folder]")!.click();
        expect(wrapper.emitted("init")).toEqual([["user.epub-export"]]);
        expect(wrapper.emitted("open")).toEqual([["user.style-guide"]]);
        expect(wrapper.emitted("open-folder")).toHaveLength(1);
        expect(row("user.drafts").querySelector<HTMLButtonElement>("[data-skill-open]")?.disabled).toBe(true);
    });

    it("展开写许可、兼容性、外部依赖、metadata 与位置，没有的项不列；展开按钮报告展开与否", async () => {
        const {wrapper, root, row} = await show(ENTRIES);
        const expand = (id: string) => row(id).querySelector<HTMLButtonElement>("[data-skill-expand]")!;
        expect(expand("user.style-guide").getAttribute("aria-expanded")).toBe("false");
        expand("user.style-guide").click();
        expand("user.voice-check").click();
        await wrapper.vm.$nextTick();
        expect(expand("user.style-guide").getAttribute("aria-expanded")).toBe("true");
        const terms = (id: string) => [...row(id).querySelectorAll("[data-skill-details] dt")].map((term) => term.textContent);
        expect(terms("user.style-guide")).toEqual(["许可", "metadata", "位置"]);
        expect(row("user.style-guide").querySelector("[data-skill-details]")?.textContent).toContain("author: 林默 · version: 0.3");
        expect(terms("user.voice-check")).toEqual(["兼容性", "外部依赖", "位置"]);
        expect(row("user.voice-check").querySelector("[data-skill-details]")?.textContent).toContain("没有找到 uv");
    });

    it("没有 Skill 时写怎样放进来；还没取到时是读取中", async () => {
        const empty = await show([]);
        expect(empty.root.querySelector("[data-skills-empty]")?.textContent).toContain("SKILL.md");
        cleanup.splice(0).forEach((dispose) => dispose());
        const loading = await show(null);
        expect(loading.root.querySelector("[role='status']")?.textContent).toContain("正在读取 Skill");
    });

    it("“打开”的地址：用户的经 user://skills/，下一层才有 SKILL.md 的打开那一层；内置的经 skills://", () => {
        expect(skillFileAddress(entry("user", "style-guide"))).toBe("user://skills/style-guide/SKILL.md");
        expect(skillFileAddress(entry("user", "outline", {status: "invalid", problem: {code: "nested", directory: "outline"}}))).toBe("user://skills/outline/outline/SKILL.md");
        expect(skillFileAddress(entry("builtin", "chapter-summary"))).toBe("skills://builtin.chapter-summary/SKILL.md");
    });
});
