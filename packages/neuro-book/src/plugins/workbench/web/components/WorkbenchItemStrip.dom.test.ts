/** WorkbenchItemStrip（同名 .md）：有命令的条目是按钮、没有的是状态文字；点击发 run；禁用带原因；没有条目时不画；名字里的标点随语言；图标与悬停内容（外壳四输出 42、43）。 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {defineComponent, h, nextTick} from "vue";
import type {Component} from "vue";

import {provideText} from "nbook/shared/testing/text-port";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {workbenchTestText} from "../../testing/text";
import {workbenchCatalogs} from "../text";

import type {HoverSource} from "../items/registry";
import WorkbenchItemStrip from "./WorkbenchItemStrip.vue";
import type {StripEntry} from "./WorkbenchItemStrip.vue";

function entry(id: string, text: string, extra: Partial<StripEntry> = {}): StripEntry {
    return {id, text, title: text, alignment: "right", order: 0, priority: 0, command: null, tooltip: null, state: "normal", disabledReason: null, icon: null, hover: null, ...extra};
}

const SAVE = {id: "nbook.editor.save-all", args: {}};

/** 悬停内容的来源：记下渲染出错的报告，替代注册表（注册表那一侧的缓存与诊断在 items/registry.test.ts）。 */
function hoverSource(load: () => Promise<Component>): HoverSource & {readonly failures: unknown[]} {
    const failures: unknown[] = [];
    return {load, failed: (error) => void failures.push(error), failures};
}

/** 提示框经门户渲染到 body：等它出现，交回它的文字。 */
async function openHover(wrapper: ReturnType<typeof mount>, id: string): Promise<string> {
    await wrapper.get(`[data-workbench-item="${id}"]`).trigger("focus");
    await vi.waitFor(() => {
        if (document.querySelector("[data-workbench-item-hover]") === null) throw new Error("the hover content is not shown yet");
    }, {timeout: 5_000});
    return document.querySelector("[data-workbench-item-hover]")?.textContent ?? "";
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("WorkbenchItemStrip", () => {
    it("有命令的条目是按钮，点击发 run；没有命令的是 role=status 的文字，名字带标题", async () => {
        const wrapper = mount(WorkbenchItemStrip, {props: {locale: "zh-CN", itemHeight: 20, align: "end", entries: [
            entry("a.unsaved", "未保存 2 个", {title: "未保存的文档", command: {id: "nbook.editor.save-all", args: {}}, tooltip: "第一章.md"}),
            entry("a.words", "1,200 字", {title: "字数"}),
        ]}, global: {provide: provideText(workbenchTestText("zh-CN"))}});
        const button = wrapper.get('[data-workbench-item="a.unsaved"]');
        expect(button.element.tagName).toBe("BUTTON");
        expect(button.attributes("title")).toBe("第一章.md");
        expect(button.attributes("aria-label")).toBe("未保存的文档：未保存 2 个");
        await button.trigger("click");
        expect(wrapper.emitted("run")).toEqual([["a.unsaved"]]);
        const text = wrapper.get('[data-workbench-item="a.words"]');
        expect(text.attributes("role")).toBe("status");
        expect(text.attributes("aria-label")).toBe("字数：1,200 字");
        // 测量层不进读屏。
        expect(wrapper.get(".workbench-item-strip__measure").attributes("aria-hidden")).toBe("true");
    });

    it("命令不可用的条目禁用并以原因作提示，点了不发事件；出错的条目带错误样式", async () => {
        const wrapper = mount(WorkbenchItemStrip, {props: {locale: "zh-CN", itemHeight: 20, align: "end", entries: [
            entry("a.save", "全部保存", {command: {id: "nbook.editor.save-all", args: {}}, disabledReason: "没有需要保存的文档"}),
            entry("a.bad", "坏条目", {state: "error", tooltip: "这个条目出错了"}),
        ]}, global: {provide: provideText(workbenchTestText("zh-CN"))}});
        const button = wrapper.get('[data-workbench-item="a.save"]');
        expect(button.attributes("disabled")).toBeDefined();
        expect(button.attributes("title")).toBe("没有需要保存的文档");
        await button.trigger("click");
        expect(wrapper.emitted("run")).toBeUndefined();
        expect(wrapper.get('[data-workbench-item="a.bad"]').classes()).toContain("workbench-item-strip__item--error");
    });

    it("名字里条目名与文字之间的标点随语言：英文用半角冒号；切换语言后原地换", async () => {
        const engine = createHostTextEngine({locale: "zh-CN", strict: true});
        engine.register("nbook.workbench", workbenchCatalogs.catalogs, workbenchCatalogs.source);
        const wrapper = mount(WorkbenchItemStrip, {props: {itemHeight: 20, align: "end", entries: [entry("a.words", "1,200 words", {title: "Words"})]}, global: {provide: provideText(engine.port)}});
        expect(wrapper.get('[data-workbench-item="a.words"]').attributes("aria-label")).toBe("Words：1,200 words");
        engine.setLocale("en-US");
        await nextTick();
        expect(wrapper.get('[data-workbench-item="a.words"]').attributes("aria-label")).toBe("Words: 1,200 words");
    });

    it("图标画在文字前：转圈、淡色；只有图标时读屏名称与提示都是条目名（外壳四输出 42）", () => {
        const wrapper = mount(WorkbenchItemStrip, {props: {itemHeight: 20, align: "end", entries: [
            entry("t.running", "3 个任务", {title: "后台任务", command: SAVE, icon: {name: "i-lucide-loader-circle", spin: true, muted: false}}),
            entry("t.idle", "", {title: "后台任务", command: SAVE, icon: {name: "i-lucide-list-checks", spin: false, muted: true}}),
            entry("t.failed", "", {title: "后台任务：1 个没有成功", state: "error", command: SAVE, icon: {name: "i-lucide-circle-x", spin: false, muted: false}}),
        ]}, global: {provide: provideText(workbenchTestText("zh-CN"))}});
        const running = wrapper.get('[data-workbench-item="t.running"]');
        expect(running.get("[data-workbench-item-icon]").classes()).toEqual(expect.arrayContaining(["i-lucide-loader-circle", "workbench-item-strip__icon--spin"]));
        expect(running.text()).toBe("3 个任务");
        expect(running.attributes("aria-label")).toBe("后台任务：3 个任务");
        const idle = wrapper.get('[data-workbench-item="t.idle"]');
        expect(idle.get("[data-workbench-item-icon]").classes()).toContain("workbench-item-strip__icon--muted");
        expect(idle.find(".workbench-item-strip__label").exists()).toBe(false);
        expect(idle.attributes("aria-label")).toBe("后台任务");
        expect(idle.attributes("title")).toBe("后台任务");
        const failed = wrapper.get('[data-workbench-item="t.failed"]');
        expect(failed.classes()).toContain("workbench-item-strip__item--error");
        expect(failed.attributes("aria-label")).toBe("后台任务：1 个没有成功");
    });

    it("有悬停内容时聚焦条目在提示框里显示加载的组件，按钮不再带 title（外壳四输出 43）", async () => {
        const Content = defineComponent({setup: () => () => h("span", "初始化 Skill epub-export · 正在安装 23 个包")});
        const wrapper = mount(WorkbenchItemStrip, {attachTo: document.body, props: {itemHeight: 20, align: "end", entries: [
            entry("t.running", "1 个任务", {title: "后台任务", command: SAVE, tooltip: "退回的文字", hover: hoverSource(async () => Content)}),
        ]}, global: {provide: provideText(workbenchTestText("zh-CN"))}});
        expect(wrapper.get('[data-workbench-item="t.running"]').attributes("title")).toBeUndefined();
        await vi.waitFor(async () => {
            expect(await openHover(wrapper, "t.running")).toBe("初始化 Skill epub-export · 正在安装 23 个包");
        }, {timeout: 5_000});
        wrapper.unmount();
    });

    it("悬停内容加载失败或渲染出错：退回提示文字，渲染出错报给来源", async () => {
        const Broken = defineComponent({setup: () => () => {
            throw new Error("render failed");
        }});
        const broken = hoverSource(async () => Broken);
        const wrapper = mount(WorkbenchItemStrip, {attachTo: document.body, props: {itemHeight: 20, align: "end", entries: [
            entry("t.broken", "1 个任务", {title: "后台任务", command: SAVE, tooltip: "退回的文字", hover: broken}),
            entry("t.rejected", "2 个任务", {title: "后台任务", command: SAVE, hover: hoverSource(async () => Promise.reject(new Error("load failed")))}),
        ]}, global: {provide: provideText(workbenchTestText("zh-CN"))}});
        await vi.waitFor(async () => {
            expect(await openHover(wrapper, "t.broken")).toBe("退回的文字");
            expect(broken.failures).toHaveLength(1);
        }, {timeout: 5_000});
        await wrapper.get('[data-workbench-item="t.broken"]').trigger("blur");
        await vi.waitFor(() => {
            expect(document.querySelector("[data-workbench-item-hover]")).toBeNull();
        }, {timeout: 5_000});
        await vi.waitFor(async () => {
            expect(await openHover(wrapper, "t.rejected")).toBe("后台任务");
        }, {timeout: 5_000});
        wrapper.unmount();
    });

    it("没有条目时什么都不画", () => {
        const wrapper = mount(WorkbenchItemStrip, {props: {locale: "zh-CN", itemHeight: 20, align: "end", entries: []}, global: {provide: provideText(workbenchTestText("zh-CN"))}});
        expect(wrapper.find("[data-workbench-item-strip]").exists()).toBe(false);
    });
});
