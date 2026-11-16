/**
 * 初始化 Skill 的确认框（docs/specs/agent/skills.md 输出 27）：几种状态下三块区域都在、只换文字与按钮；没有锁时那句写在说明行；
 * 失败后中间一块是安装输出。文字引擎是严格的，缺键直接失败。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText} from "nbook/shared/testing/text-port";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import type {SkillInitPlan} from "../shared/skills";
import SkillInitDialog from "./components/SkillInitDialog.vue";
import type {SkillInitFailure, SkillInitPhase} from "./skill-init";
import {agentCatalogs} from "./text";

const cleanup: Array<() => void> = [];
afterEach(() => {
    for (const dispose of cleanup.splice(0)) dispose();
    document.body.innerHTML = "";
});

const LOCKED: SkillInitPlan = {lock: true, packages: 23, dependencies: ["epub-gen-memory", "jszip", "turndown", "yaml"]};
const UNLOCKED: SkillInitPlan = {lock: false, dependencies: ["epub-gen-memory", "jszip"]};

async function show(props: {phase: SkillInitPhase; plan: SkillInitPlan | null; failure?: SkillInitFailure | null}) {
    const text = createHostTextEngine({locale: "zh-CN", strict: true});
    text.register("nbook.agent", agentCatalogs.catalogs, agentCatalogs.source);
    const wrapper = mount(SkillInitDialog, {props: {open: true, name: "epub-export", failure: null, ...props}, attachTo: document.body, global: {provide: provideText(text.port)}});
    cleanup.push(() => wrapper.unmount());
    await flushPromises();
    const part = (name: string) => document.querySelector(`[data-skill-init-${name}]`);
    return {
        wrapper,
        head: () => part("head")?.textContent?.trim(),
        box: () => part("box")?.textContent,
        note: () => part("note")?.textContent?.trim(),
        buttons: () => [...document.querySelectorAll<HTMLButtonElement>("[data-skill-init] button")].filter((button) => button.textContent?.trim() !== "").map((button) => ({label: button.textContent?.trim(), disabled: button.disabled})),
    };
}

describe("SkillInitDialog", () => {
    it("确认：写要装几个包与联网，中间列直接依赖，说明写安装脚本不运行；点“初始化”发 confirm，焦点不在它上面", async () => {
        const dialog = await show({phase: "confirm", plan: LOCKED});
        expect(dialog.head()).toBe("要装 23 个包，需要联网。");
        expect(dialog.box()).toBe("epub-gen-memory\njszip\nturndown\nyaml");
        expect(dialog.note()).toContain("安装脚本不会运行");
        expect(dialog.buttons()).toEqual([{label: "先不初始化", disabled: false}, {label: "初始化", disabled: false}]);
        expect(document.activeElement?.hasAttribute("data-skill-init-confirm")).toBe(false);
        document.querySelector<HTMLButtonElement>("[data-skill-init-confirm]")!.click();
        expect(dialog.wrapper.emitted("confirm")).toHaveLength(1);
        document.querySelector<HTMLButtonElement>("[data-skill-init-later]")!.click();
        expect(dialog.wrapper.emitted("update:open")).toEqual([[false]]);
    });

    it("没有锁：状态行写直接依赖的个数，生成锁文件的那句在说明行，不另起一行", async () => {
        const dialog = await show({phase: "confirm", plan: UNLOCKED});
        expect(dialog.head()).toBe("要装 2 个直接依赖，需要联网。");
        expect(dialog.note()).toContain("会按最新版本解析依赖并生成锁文件");
        expect(document.querySelector("[data-skill-init-note]")?.classList.contains("is-warning")).toBe(true);
    });

    it("读取中“初始化”不可用；安装中只有“在后台继续装”，中间仍列依赖", async () => {
        expect((await show({phase: "loading", plan: null})).buttons()).toEqual([{label: "先不初始化", disabled: false}, {label: "初始化", disabled: true}]);
        cleanup.splice(0).forEach((dispose) => dispose());
        const installing = await show({phase: "installing", plan: LOCKED});
        expect(installing.head()).toBe("正在安装…");
        expect(installing.box()).toContain("jszip");
        expect(installing.note()).toContain("后台继续装");
        expect(installing.buttons()).toEqual([{label: "在后台继续装", disabled: false}]);
        document.querySelector<HTMLButtonElement>("[data-skill-init-background]")!.click();
        expect(installing.wrapper.emitted("update:open")).toEqual([[false]]);
    });

    it("失败：中间换成安装输出，说明行写怎么办；“重试”发 confirm；别处在装时写 busy 的说明", async () => {
        const failed = await show({phase: "failed", plan: LOCKED, failure: {code: "install-failed", output: "error: GET https://registry.npmjs.org/jszip - ETIMEDOUT"}});
        expect(failed.head()).toBe("初始化没有成功。");
        expect(failed.box()).toContain("ETIMEDOUT");
        expect(failed.note()).toContain("重试");
        expect(failed.buttons()).toEqual([{label: "关闭", disabled: false}, {label: "重试", disabled: false}]);
        document.querySelector<HTMLButtonElement>("[data-skill-init-confirm]")!.click();
        expect(failed.wrapper.emitted("confirm")).toHaveLength(1);
        cleanup.splice(0).forEach((dispose) => dispose());
        const busy = await show({phase: "failed", plan: LOCKED, failure: {code: "busy", output: ""}});
        expect(busy.box()).toContain("jszip");
        expect(busy.note()).toContain("正在别处初始化");
    });
});
