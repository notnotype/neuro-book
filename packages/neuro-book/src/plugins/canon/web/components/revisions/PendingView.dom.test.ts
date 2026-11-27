/** PendingView、PendingDetail、BreakExclusiveDialog（同名 .md，docs/specs/canon/author-ui.md 输出 23、30）：三组怎么画、选中与键盘、详情里点了发什么、强行解除的二次确认。 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {PendingDetailModel, PendingGroup} from "../../pending";
import {canonCatalogs} from "../../text";
import BreakExclusiveDialog from "./BreakExclusiveDialog.vue";
import PendingView from "./PendingView.vue";
import type {PendingGroupState} from "./PendingView.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const global = {provide: provideText(port)};

const state = (rows: readonly {key: string; text: string; place?: string}[], extra: Partial<PendingGroupState> = {}): PendingGroupState => ({rows: rows.map((row) => ({place: "", ...row})), count: rows.length, loading: false, more: false, ...extra});
const groups: Record<PendingGroup, PendingGroupState> = {
    pending: state([{key: "a", text: "星瑕的存款对不上：正文写 500，算出来是 1,000", place: "第 2 章"}, {key: "b", text: "“领了工资”待定", place: "第 3 章"}]),
    hints: state([{key: "h", text: "“领了工资”的原句在这一章出现了 2 次"}]),
    handled: state([], {count: 4}),
};
const detail: PendingDetailModel = {
    title: "星瑕的存款对不上：正文写 500，算出来是 1,000",
    place: "第 2 章",
    quote: {text: "余额 500", chapter: "2"},
    facts: [{label: "正文写的数", value: "500"}, {label: "算出来的数", value: "1,000"}],
    suspects: [
        {key: "c2", text: "被扒手偷了", place: "第 2 章", estimate: true, target: {kind: "change", id: "c2"}, initial: false},
        {key: "init", text: "最初", place: "", estimate: false, target: {kind: "entry", id: "e1"}, initial: true},
    ],
    links: [{label: "打开条目", target: {kind: "entry", id: "e1"}}],
};

afterEach(() => {
    document.body.innerHTML = "";
});

const rowOf = (wrapper: ReturnType<typeof mount>, group: PendingGroup, key: string) => wrapper.get(`[data-row='${group}:${key}']`);
const focusedRow = (): string | null => document.activeElement?.getAttribute("data-row") ?? null;

describe("PendingView", () => {
    it("三组各有展开按钮与条数，收起的组只写条数；点了发新的展开列表；一行写是什么与位置，选中的那行标出来", async () => {
        const wrapper = mount(PendingView, {props: {groups, expanded: ["pending"], selected: {group: "pending", key: "b"}}, global});
        expect(wrapper.findAll("[data-pending-toggle]").map((toggle) => toggle.text().replace(/\s+/gu, ""))).toEqual(["待处理2", "只是提示1", "已处理4"]);
        expect(wrapper.findAll("[data-pending-toggle]").map((toggle) => toggle.attributes("aria-expanded"))).toEqual(["true", "false", "false"]);
        expect(wrapper.findAll("[data-pending-row]")).toHaveLength(2);
        expect(rowOf(wrapper, "pending", "a").get("[data-pending-row-place]").text()).toBe("第 2 章");
        expect(rowOf(wrapper, "pending", "b").attributes("aria-current")).toBe("true");
        expect(rowOf(wrapper, "pending", "a").attributes("aria-current")).toBeUndefined();

        await wrapper.findAll("[data-pending-toggle]")[1]!.trigger("click");
        await wrapper.findAll("[data-pending-toggle]")[0]!.trigger("click");
        expect(wrapper.emitted("update:expanded")).toEqual([[["pending", "hints"]], [[]]]);
    });

    it("上下键在展开的各组的行之间移，选中跟着焦点走；只有选中的那行在 Tab 序列里", async () => {
        const wrapper = mount(PendingView, {props: {groups, expanded: ["pending", "hints"], selected: {group: "pending", key: "a"}}, global, attachTo: document.body});
        expect(wrapper.findAll("[data-pending-row]").filter((row) => row.attributes("tabindex") === "0").map((row) => row.attributes("data-row"))).toEqual(["pending:a"]);
        (rowOf(wrapper, "pending", "a").element as HTMLElement).focus();
        await rowOf(wrapper, "pending", "a").trigger("keydown", {key: "ArrowDown"});
        expect(focusedRow()).toBe("pending:b");
        await rowOf(wrapper, "pending", "b").trigger("keydown", {key: "ArrowDown"});
        expect(focusedRow()).toBe("hints:h");
        await rowOf(wrapper, "hints", "h").trigger("keydown", {key: "Home"});
        expect(focusedRow()).toBe("pending:a");
        expect(wrapper.emitted("select")).toEqual([["pending", "a"], ["pending", "b"], ["hints", "h"], ["pending", "a"]]);
    });

    it("展开了还没读到写“读取中…”，读到了没有写空状态；没列完时“再显示更多”", async () => {
        const wrapper = mount(PendingView, {props: {groups: {...groups, pending: state([], {count: null, loading: true}), hints: state([], {count: 0}), handled: state([{key: "x", text: "传话链断了"}], {more: true})}, expanded: ["pending", "hints", "handled"]}, global});
        expect(wrapper.get("[data-pending-group='pending'] [aria-busy='true']").text()).toBe("读取中…");
        expect(wrapper.get("[data-pending-group='pending'] [data-pending-toggle]").find("[data-pending-count]").exists()).toBe(false);
        expect(wrapper.get("[data-pending-group='hints'] [data-pending-empty]").text()).toBe("没有提示");
        await wrapper.get("[data-pending-group='handled'] [data-pending-more]").trigger("click");
        expect(wrapper.emitted("more")).toEqual([["handled"]]);
    });

    it("没有选中时详情写一句；有人独占写入时写是谁、点“强行解除”发事件；结果不完整的几句写在列表顶上", async () => {
        const wrapper = mount(PendingView, {props: {groups, expanded: ["pending"], holder: "第 3 章记账", notes: ["这些检查没有算出来：传话链断了"]}, global});
        expect(wrapper.get("[data-pending-no-selection]").text()).toBe("选一条看详情");
        expect(wrapper.get("[data-pending-busy]").text()).toContain("第 3 章记账正在独占写入");
        expect(wrapper.get("[data-pending-incomplete]").text()).toBe("这些检查没有算出来：传话链断了");
        await wrapper.get("[data-pending-break]").trigger("click");
        expect(wrapper.emitted("break-exclusive")).toEqual([[]]);
    });

    it("详情：原句与“打开这一章”，正文写的与算出来的数，嫌疑的每一笔（估计的标出来，初值是“打开条目”），点了发出对象", async () => {
        const wrapper = mount(PendingView, {props: {groups, expanded: ["pending"], selected: {group: "pending", key: "a"}, detail}, global});
        expect(wrapper.get("[data-pending-detail-quote]").text()).toContain("“余额 500”");
        await wrapper.get("[data-pending-open-chapter]").trigger("click");
        expect(wrapper.emitted("open-chapter")).toEqual([["2"]]);
        expect([...wrapper.get("[data-pending-detail-facts]").element.querySelectorAll("dt")].map((term) => `${term.textContent ?? ""}：${term.nextElementSibling?.textContent ?? ""}`)).toEqual(["正文写的数：500", "算出来的数：1,000"]);
        expect(wrapper.get("[data-suspect='c2'] [data-suspect-estimate]").text()).toBe("估计");
        expect(wrapper.find("[data-suspect='init'] [data-suspect-estimate]").exists()).toBe(false);
        expect(wrapper.get("[data-suspect='init'] [data-suspect-open]").text()).toBe("打开条目");
        await wrapper.get("[data-suspect='c2'] [data-suspect-open]").trigger("click");
        await wrapper.get("[data-suspect='init'] [data-suspect-open]").trigger("click");
        expect(wrapper.emitted("open")).toEqual([[{kind: "change", id: "c2"}], [{kind: "entry", id: "e1"}]]);
    });
});

describe("BreakExclusiveDialog", () => {
    it("写明是谁，“强行解除”发 confirm；解除中两个按钮都不可用；失败写原因", async () => {
        const wrapper = mount(BreakExclusiveDialog, {props: {open: true, holder: "第 3 章记账"}, global, attachTo: document.body});
        const dialog = (): HTMLElement => document.body.querySelector<HTMLElement>("[role='dialog']")!;
        const button = (label: string): HTMLButtonElement => [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === label)!;
        await waitUntil("对话框", () => document.body.querySelector("[data-break-exclusive-dialog]") !== null);
        expect(dialog().textContent).toContain("强行解除“第 3 章记账”的独占写入？");
        button("强行解除").click();
        expect(wrapper.emitted("confirm")).toEqual([[]]);
        await wrapper.setProps({saving: true});
        expect([button("取消").disabled, button("强行解除").disabled]).toEqual([true, true]);
        await wrapper.setProps({saving: false, error: "世界已断开"});
        expect(dialog().querySelector("[role='alert']")?.textContent).toBe("世界已断开");
        wrapper.unmount();
    });
});
