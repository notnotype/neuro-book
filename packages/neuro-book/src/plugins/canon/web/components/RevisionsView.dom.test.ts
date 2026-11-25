/** RevisionsView（同名 .md，docs/specs/canon/author-ui.md 输出 24）：一行写什么、点了发什么、还原什么时候不可用、键盘在行之间移。 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {ALL} from "../revisions";
import type {RevisionRow} from "../revisions";
import {canonCatalogs} from "../text";
import RevisionsView from "./RevisionsView.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const global = {provide: provideText(port)};

const rows: RevisionRow[] = [
    {id: "r3", title: "调整章序", meta: "作者 · 2026-11-13 14:05", summary: "没有带来别的变化", notRevertable: true, note: "调整章序的改动不能还原"},
    {id: "r2", title: "改存款", meta: "Agent · 2026-11-13 14:03", summary: "1 处值变了，少了 1 条待处理", notRevertable: false, note: ""},
    {id: "r1", title: "新建“星瑕”", meta: "作者 · 2026-11-13 14:01", summary: "没有带来别的变化", notRevertable: false, note: "后面有 1 次改动依赖它"},
];
const filters = {chapters: [{value: ALL, label: "全部章"}], writers: [{value: ALL, label: "全部写入者"}], chapter: ALL, writer: ALL};

afterEach(() => {
    document.body.innerHTML = "";
});

const rowOf = (wrapper: ReturnType<typeof mount>, id: string) => wrapper.get(`[data-row='${id}']`);

describe("RevisionsView", () => {
    it("一行写标题、谁、什么时候与摘要；“查看详情”“还原”发出修订 id；章序调整不能还原、写原因；有依赖的写一句、照样能点", async () => {
        const wrapper = mount(RevisionsView, {props: {status: "normal", rows, ...filters}, global});
        expect(wrapper.findAll("[data-revision-title]").map((title) => title.text())).toEqual(["调整章序", "改存款", "新建“星瑕”"]);
        expect(rowOf(wrapper, "r2").get("[data-revision-meta]").text()).toBe("Agent · 2026-11-13 14:03 · 1 处值变了，少了 1 条待处理");

        expect(rowOf(wrapper, "r3").get("[data-revision-revert]").attributes("disabled")).toBeDefined();
        expect(rowOf(wrapper, "r3").get("[data-revision-note]").text()).toBe("调整章序的改动不能还原");
        expect(rowOf(wrapper, "r1").get("[data-revision-note]").text()).toBe("后面有 1 次改动依赖它");
        expect(rowOf(wrapper, "r2").find("[data-revision-note]").exists()).toBe(false);

        await rowOf(wrapper, "r2").get("[data-revision-receipt]").trigger("click");
        await rowOf(wrapper, "r1").get("[data-revision-revert]").trigger("click");
        await rowOf(wrapper, "r3").get("[data-revision-revert]").trigger("click");
        expect(wrapper.emitted("receipt")).toEqual([["r2"]]);
        expect(wrapper.emitted("revert")).toEqual([["r1", "新建“星瑕”"]]);
    });

    it("世界写不了时还原都不可用：别人在独占写时列表顶上写原因；断开、只读另有横幅，不再写一遍", async () => {
        const wrapper = mount(RevisionsView, {props: {status: "normal", rows, ...filters, revertBlocked: "第 3 章记账正在写，写完以后才能改"}, global});
        expect(wrapper.findAll("[data-revision-revert]").every((button) => button.attributes("disabled") !== undefined)).toBe(true);
        expect(wrapper.findAll("[data-revision-receipt]").every((button) => button.attributes("disabled") === undefined)).toBe(true);
        expect(wrapper.get("[data-revisions-blocked]").text()).toBe("第 3 章记账正在写，写完以后才能改");

        await wrapper.setProps({revertBlocked: "世界只读：日志坏了", readOnly: "世界只读：日志坏了"});
        expect(wrapper.find("[data-revisions-blocked]").exists()).toBe(false);
        expect(wrapper.get("[data-read-only]").text()).toContain("世界只读：日志坏了");
    });

    it("上下键、Home、End 在行之间移焦点，只有当前行与它的按钮在 Tab 序列里，得到焦点的行报成当前行", async () => {
        const wrapper = mount(RevisionsView, {props: {status: "normal", rows, ...filters, current: "r2", "onUpdate:current": (id: string) => void wrapper.setProps({current: id})}, global, attachTo: document.body});
        const tabbable = (): string[] => wrapper.findAll("[data-row]").filter((row) => row.attributes("tabindex") === "0").map((row) => row.attributes("data-row")!);
        expect(tabbable()).toEqual(["r2"]);
        expect(rowOf(wrapper, "r2").findAll("button").map((button) => button.attributes("tabindex"))).toEqual(["0", "0"]);
        expect(rowOf(wrapper, "r1").findAll("button").map((button) => button.attributes("tabindex"))).toEqual(["-1", "-1"]);

        (rowOf(wrapper, "r2").element as HTMLElement).focus();
        await rowOf(wrapper, "r2").trigger("keydown", {key: "ArrowDown"});
        expect(document.activeElement?.getAttribute("data-row")).toBe("r1");
        await wrapper.vm.$nextTick();
        expect(tabbable()).toEqual(["r1"]);
        // 最后一行再往下不动。
        await rowOf(wrapper, "r1").trigger("keydown", {key: "ArrowDown"});
        expect(document.activeElement?.getAttribute("data-row")).toBe("r1");
        await rowOf(wrapper, "r1").trigger("keydown", {key: "Home"});
        expect(document.activeElement?.getAttribute("data-row")).toBe("r3");
        // 焦点在行里的按钮上时方向键同样在行之间移。
        (rowOf(wrapper, "r3").get("[data-revision-receipt]").element as HTMLElement).focus();
        await rowOf(wrapper, "r3").get("[data-revision-receipt]").trigger("keydown", {key: "End"});
        expect(document.activeElement?.getAttribute("data-row")).toBe("r1");
        await rowOf(wrapper, "r1").trigger("keydown", {key: "ArrowUp"});
        expect(document.activeElement?.getAttribute("data-row")).toBe("r2");
        expect(wrapper.emitted("update:current")?.at(-1)).toEqual(["r2"]);
    });

    it("当前行不在列表里时第一行在 Tab 序列里；有更多时末尾“再显示更多”", async () => {
        const wrapper = mount(RevisionsView, {props: {status: "normal", rows, ...filters, current: "gone", more: true}, global});
        expect(wrapper.findAll("[data-row]").filter((row) => row.attributes("tabindex") === "0").map((row) => row.attributes("data-row"))).toEqual(["r3"]);
        await wrapper.get("[data-revisions-more]").trigger("click");
        expect(wrapper.emitted("more")).toEqual([[]]);
    });

    it("读取中、读不出来、空列表各写一句；有筛选时空列表说没有符合筛选的", async () => {
        const wrapper = mount(RevisionsView, {props: {status: "loading", rows: [], ...filters}, global});
        expect(wrapper.get("[aria-busy='true']").text()).toBe("读取中…");
        await wrapper.setProps({status: "failed"});
        expect(wrapper.get("[role='alert']").text()).toBe("没有读出来");
        await wrapper.setProps({status: "normal"});
        expect(wrapper.get("[data-revisions-empty]").text()).toBe("还没有改动");
        await wrapper.setProps({writer: "agent", writers: [...filters.writers, {value: "agent", label: "Agent"}]});
        expect(wrapper.get("[data-revisions-empty]").text()).toBe("没有符合筛选的改动");
    });
});
