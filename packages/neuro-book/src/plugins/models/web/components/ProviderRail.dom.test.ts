/**
 * ProviderRail（同名 .md，docs/specs/models/settings-pages.md 输出 1、12）：单行条目的行尾一格，与三条删除的路
 * （删除图标、右键菜单、Delete 键）。只发 `remove`，确认框是页面的事。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {SAMPLE_PROVIDERS} from "nbook/plugins/lab/web/fixtures/models-scene/sample";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {MODELS_TEXT_NAMESPACE} from "../../shared/text";
import {modelsCatalogs} from "../text";
import ProviderRail from "./ProviderRail.vue";

const global = {provide: provideText(testTextPort("zh-CN", {[MODELS_TEXT_NAMESPACE]: modelsCatalogs}))};

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

function render(props: {disabled?: boolean} = {}) {
    const wrapper = mount(ProviderRail, {global, props: {providers: SAMPLE_PROVIDERS, current: "deepseek", ...props}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}

const item = (id: string): HTMLElement => {
    const found = document.body.querySelector<HTMLElement>(`[data-provider-rail-item="${id}"]`);
    if (found === null) throw new Error(`没有条目 ${id}`);
    return found;
};

const descriptionOf = (element: HTMLElement): string => document.getElementById(element.getAttribute("aria-describedby") ?? "")?.textContent ?? "";

describe("ProviderRail", () => {
    it("行尾一格：没问题写模型数，密钥的问题是图标，原因是条目的读屏描述", async () => {
        render();
        await flushPromises();
        expect(item("deepseek").querySelector("[data-provider-status]")?.textContent?.trim()).toBe("2");
        expect(descriptionOf(item("deepseek"))).toBe("2 个模型");
        expect(item("anthropic").querySelector("[data-provider-status]")?.getAttribute("data-provider-status")).toBe("error");
        expect(descriptionOf(item("anthropic"))).toBe("环境变量没有值");
        expect(item("openai").querySelector("[data-provider-status]")?.getAttribute("data-provider-status")).toBe("warning");
        expect(descriptionOf(item("openai"))).toBe("没有密钥");
        // 本机端点不要密钥，照常写模型数。
        expect(descriptionOf(item("ollama"))).toBe("1 个模型");
    });

    it("删除图标、Delete 键与右键菜单都发 remove，带那一家的 id", async () => {
        const wrapper = render();
        await flushPromises();
        document.body.querySelector<HTMLElement>("[data-provider-remove='anthropic']")!.click();
        item("openai").dispatchEvent(new KeyboardEvent("keydown", {key: "Delete", bubbles: true, cancelable: true}));
        item("volcengine").closest(".provider-rail__row")!.dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true, clientX: 40, clientY: 80}));
        await flushPromises();
        const entry = [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")].find((element) => element.textContent?.includes("删除服务商…"));
        expect(entry).toBeDefined();
        entry!.click();
        await flushPromises();
        expect(wrapper.emitted("remove")).toEqual([["anthropic"], ["openai"], ["volcengine"]]);
        // 删除不改选中。
        expect(wrapper.emitted("select")).toBeUndefined();
    });

    it("“全部模型”与只读时没有删除", async () => {
        const wrapper = render({disabled: true});
        await flushPromises();
        expect(document.body.querySelector("[data-provider-remove]")).toBeNull();
        item("openai").dispatchEvent(new KeyboardEvent("keydown", {key: "Delete", bubbles: true, cancelable: true}));
        wrapper.setProps({disabled: false});
        await flushPromises();
        item("all").dispatchEvent(new KeyboardEvent("keydown", {key: "Delete", bubbles: true, cancelable: true}));
        await flushPromises();
        expect(wrapper.emitted("remove")).toBeUndefined();
    });
});
