/**
 * NewEntryDialog（同名 .md，docs/specs/canon/author-ui.md 输出 4）：名字为空时“新建”不可用；改字段发新的完整草稿；分组跟着
 * 种类，改过分组以后不跟；选了另一个身份以后放在它下面；保存中不能关、按钮不可用。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {emptyDraft} from "../new-entry";
import type {NewEntryDraft} from "../new-entry";
import {canonCatalogs} from "../text";
import NewEntryDialog from "./NewEntryDialog.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

async function dialog(draft: NewEntryDraft, extra: Record<string, unknown> = {}) {
    const wrapper = mount(NewEntryDialog, {props: {open: true, draft, kinds: ["人物", "地点"], entries: [{id: "e1", name: "星瑕"}], ...extra}, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    const root = (): Element => document.body.querySelector("[role='dialog']")!;
    const button = (label: string): HTMLButtonElement => [...root().querySelectorAll("button")].find((item) => item.textContent?.trim() === label)!;
    const inputs = (): HTMLInputElement[] => [...root().querySelectorAll("input")] as HTMLInputElement[];
    await waitUntil("对话框挂出来", () => document.body.querySelector("[role='dialog'] [data-new-entry]") !== null);
    return {wrapper, root, button, inputs};
}

describe("NewEntryDialog", () => {
    it("名字为空时“新建”不可用；有名字以后可用，点了发 confirm", async () => {
        const empty = await dialog(emptyDraft(null));
        expect(empty.button("新建").disabled).toBe(true);
        empty.wrapper.unmount();
        const named = await dialog({...emptyDraft(null), name: "魔杖"});
        expect(named.button("新建").disabled).toBe(false);
        named.button("新建").click();
        expect(named.wrapper.emitted("confirm")).toHaveLength(1);
    });

    it("改种类发新的草稿，分组跟着种类；点已有的种类填进去；改过分组以后不再跟", async () => {
        const {wrapper, button, inputs} = await dialog(emptyDraft(null));
        const kind = inputs()[1]!;
        kind.value = "物品";
        kind.dispatchEvent(new Event("input", {bubbles: true}));
        expect(wrapper.emitted("update:draft")?.at(-1)?.[0]).toMatchObject({kind: "物品", folder: "物品", folderTouched: false});
        button("地点").click();
        expect(wrapper.emitted("update:draft")?.at(-1)?.[0]).toMatchObject({kind: "地点", folder: "地点"});
        await wrapper.setProps({draft: {...emptyDraft(null), kind: "地点", folder: "城市", folderTouched: true}});
        button("人物").click();
        expect(wrapper.emitted("update:draft")?.at(-1)?.[0]).toMatchObject({kind: "人物", folder: "城市", folderTouched: true});
    });

    it("保存中：按钮不可用；原因写在对话框里", async () => {
        const {button, root} = await dialog({...emptyDraft(null), name: "魔杖"}, {saving: true, error: "这次改动没有成功"});
        expect(button("新建").disabled).toBe(true);
        expect(button("取消").disabled).toBe(true);
        expect(root().querySelector("[role='alert']")?.textContent).toBe("这次改动没有成功");
    });
});
