/** RevertDialog（同名 .md，docs/specs/canon/author-ui.md 输出 22、29）：各阶段写什么、给哪个按钮，写不了与保存中时按钮不可用。 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {RevertPhase} from "../../revert";
import {canonCatalogs} from "../../text";
import RevertDialog from "./RevertDialog.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});

afterEach(() => {
    document.body.innerHTML = "";
});

async function open(props: {phase: RevertPhase} & Record<string, unknown>) {
    const wrapper = mount(RevertDialog, {props: {open: true, title: "改外观", ...props}, global: {provide: provideText(port)}, attachTo: document.body});
    await waitUntil("对话框", () => document.body.querySelector("[data-revert-dialog]") !== null);
    return wrapper;
}
const body = (): string => document.body.querySelector("[role='dialog']")?.textContent ?? "";
const button = (label: string): HTMLButtonElement | undefined => [...document.body.querySelectorAll<HTMLButtonElement>("[role='dialog'] button")].find((item) => item.textContent?.trim() === label);

describe("RevertDialog", () => {
    it("没有依赖：标题问还原哪一次，写带来的变化，“还原”发 confirm", async () => {
        const wrapper = await open({phase: "ready", impact: ["星瑕的外观：银发 → 黑发", "少了 1 条待处理"]});
        expect(body()).toContain("还原“改外观”？");
        expect([...document.body.querySelectorAll("[data-revert-impact] li")].map((item) => item.textContent)).toEqual(["星瑕的外观：银发 → 黑发", "少了 1 条待处理"]);
        button("还原")!.click();
        expect(wrapper.emitted("confirm")).toHaveLength(1);
        wrapper.unmount();
    });

    it("有依赖：从新到旧列出，没读到的写“读取中…”，列不下的写还有几次；只有“连同这些一起还原”", async () => {
        const wrapper = await open({phase: "dependents", dependents: ["改成红发", null], moreDependents: 3});
        expect([...document.body.querySelectorAll("[data-revert-dependents] li")].map((item) => item.textContent)).toEqual(["改成红发", "读取中…", "还有 3 次"]);
        expect(button("还原")).toBeUndefined();
        button("连同这些一起还原")!.click();
        expect(wrapper.emitted("confirm")).toHaveLength(1);
        wrapper.unmount();
    });

    it("不能还原：只写原因，没有确认按钮，取消按钮写“关闭”", async () => {
        const wrapper = await open({phase: "blocked", reason: "调整章序的改动不能还原"});
        expect(document.body.querySelector("[data-revert-reason]")?.textContent).toBe("调整章序的改动不能还原");
        expect(button("还原")).toBeUndefined();
        expect(button("连同这些一起还原")).toBeUndefined();
        button("关闭")!.click();
        expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
        wrapper.unmount();
    });

    it("写不了、预览中、保存中时确认按钮不可用；结局不明时给“再查一次”", async () => {
        const blocked = await open({phase: "ready", impact: ["别的都不变"], reason: "第 3 章记账正在写，写完以后才能改"});
        expect(button("还原")!.disabled).toBe(true);
        blocked.unmount();
        const previewing = await open({phase: "previewing"});
        expect(body()).toContain("正在预览…");
        expect(button("还原")!.disabled).toBe(true);
        previewing.unmount();
        const saving = await open({phase: "ready", impact: [], saving: true});
        expect(button("还原")!.disabled).toBe(true);
        expect(button("取消")!.disabled).toBe(true);
        saving.unmount();
        const unknown = await open({phase: "ready", impact: [], error: "不确定这次改动有没有写进去", recheck: true});
        expect(document.body.querySelector("[role='dialog'] [role='alert']")?.textContent).toContain("不确定这次改动有没有写进去");
        button("再查一次")!.click();
        expect(unknown.emitted("recheck")).toHaveLength(1);
        unknown.unmount();
    });
});
