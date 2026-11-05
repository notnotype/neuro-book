/**
 * ModelEditDialog（同名 .md）的压缩触发点（docs/specs/models/service.md 输出 17）：模型自己的配置盖过全局设置；
 * 不改就不写，改了写新的形状；百分比不能超过 100。
 */

import {NumberInput, Select} from "@notnotype/nb-ui/components";
import {flushPromises, mount} from "@vue/test-utils";
import type {VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {SnapshotModel} from "../../shared/contracts";
import {MODELS_TEXT_NAMESPACE} from "../../shared/text";
import {modelsCatalogs} from "../text";
import ModelEditDialog from "./ModelEditDialog.vue";

const global = {provide: provideText(testTextPort("zh-CN", {[MODELS_TEXT_NAMESPACE]: modelsCatalogs}))};
const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const model = (patch: Partial<SnapshotModel> = {}): SnapshotModel => ({id: "m", name: "m", group: "g", enabled: true, contextWindow: 200_000, maxOutput: null, vision: false, reasoning: false, efforts: [], compaction: null, price: null, headers: {}, status: "ok", ...patch});

async function open(snapshot: SnapshotModel) {
    const wrapper = mount(ModelEditDialog, {global, props: {open: true, providerKind: "custom", model: snapshot}, attachTo: document.body});
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

/** 触发点的那个 Select 是对话框里的最后一个（别的 Select 都不在这个窗口里，这里只有它）。 */
const modeSelect = (wrapper: VueWrapper) => wrapper.findAllComponents(Select).at(-1)!;
const valueInput = (wrapper: VueWrapper) => wrapper.findAllComponents(NumberInput).find((input) => input.attributes("data-field") === "compactValue" || input.html().includes('data-field="compactValue"'));

async function save(wrapper: VueWrapper): Promise<void> {
    const button = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === "保存");
    if (button === undefined) throw new Error("没有保存按钮");
    button.click();
    await flushPromises();
}

describe("触发点", () => {
    it("默认跟随全局：不显示数值框，保存的配置里没有 compaction", async () => {
        const wrapper = await open(model());
        expect(modeSelect(wrapper).props("modelValue")).toBe("follow");
        expect(valueInput(wrapper)).toBeUndefined();
        await save(wrapper);
        const saved = wrapper.emitted("save")!.at(-1)![0] as Record<string, unknown>;
        expect(saved).not.toHaveProperty("compaction");
        expect(saved).not.toHaveProperty("compactAt");
    });

    it("选百分比并填 50：保存新的形状；旧配置的固定触发点打开时就是“固定的 token 数”，值带进来", async () => {
        const wrapper = await open(model());
        await modeSelect(wrapper).vm.$emit("update:modelValue", "percent");
        await flushPromises();
        valueInput(wrapper)!.vm.$emit("update:modelValue", "50");
        await flushPromises();
        await save(wrapper);
        expect((wrapper.emitted("save")!.at(-1)![0] as {compaction: unknown}).compaction).toEqual({mode: "percent", value: 50});

        const old = await open(model({compaction: {mode: "tokens", value: 40_000}}));
        expect(modeSelect(old).props("modelValue")).toBe("tokens");
        expect(valueInput(old)!.props("modelValue")).toBe("40000");
    });

    it("百分比超过 100 不能保存；预留量的基数可以留空", async () => {
        const wrapper = await open(model());
        await modeSelect(wrapper).vm.$emit("update:modelValue", "percent");
        await flushPromises();
        valueInput(wrapper)!.vm.$emit("update:modelValue", "150");
        await flushPromises();
        await save(wrapper);
        expect(wrapper.emitted("save")).toBeUndefined();
        expect(document.body.textContent).toContain("要是 1 到 100 的整数");

        await modeSelect(wrapper).vm.$emit("update:modelValue", "reserve");
        valueInput(wrapper)!.vm.$emit("update:modelValue", "");
        await flushPromises();
        await save(wrapper);
        expect((wrapper.emitted("save")!.at(-1)![0] as {compaction: unknown}).compaction).toEqual({mode: "reserve"});
    });

    it("固定的 token 数必填；换模式时清掉上一种模式的数值，不让 80（百分比）当成 80 token 保存", async () => {
        const wrapper = await open(model());
        await modeSelect(wrapper).vm.$emit("update:modelValue", "percent");
        await flushPromises();
        valueInput(wrapper)!.vm.$emit("update:modelValue", "80");
        await flushPromises();
        await modeSelect(wrapper).vm.$emit("update:modelValue", "tokens");
        await flushPromises();
        expect(valueInput(wrapper)!.props("modelValue")).toBe("");
        await save(wrapper);
        expect(wrapper.emitted("save")).toBeUndefined();
        expect(document.body.textContent).toContain("要是正整数");
    });
});
