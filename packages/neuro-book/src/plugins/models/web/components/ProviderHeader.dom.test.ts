/**
 * ProviderHeader（同名 .md）的上传与错误：客户端缩图后发 base64、拒收 SVG 与非图片原位写原因、父组件交回的失败写在面板里；
 * 改名重名不发事件。缩图用的解码与编码是注入的假实现，真实图片在 e2e 里验。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";
import {SAMPLE_PROVIDERS} from "nbook/plugins/models/web/lab/sample";

import {MODELS_TEXT_NAMESPACE} from "../../shared/text";
import type {IconCodec} from "../icon-scale";
import {modelsCatalogs} from "../text";
import ProviderHeader from "./ProviderHeader.vue";

const global = {provide: provideText(testTextPort("zh-CN", {[MODELS_TEXT_NAMESPACE]: modelsCatalogs}))};
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const codec: IconCodec = {decode: async () => ({width: 300, height: 100, encode: async () => new Uint8Array([1, 2, 3])})};

async function render(props: Record<string, unknown> = {}) {
    const wrapper = mount(ProviderHeader, {global, props: {provider: SAMPLE_PROVIDERS[0], builtinKeys: ["deepseek"], codec, ...props}, attachTo: document.body});
    mounted.push(wrapper);
    document.body.querySelector<HTMLButtonElement>("[data-provider-icon-button]")!.click();
    await flushPromises();
    const tab = [...document.body.querySelectorAll<HTMLElement>("button, [role='radio'], [role='tab']")].find((item) => item.textContent?.trim() === "上传");
    tab?.click();
    await flushPromises();
    return wrapper;
}

async function choose(file: File): Promise<void> {
    const input = document.body.querySelector<HTMLInputElement>("[data-icon-file]")!;
    Object.defineProperty(input, "files", {value: [file], configurable: true});
    input.dispatchEvent(new Event("change", {bubbles: true}));
    await flushPromises();
}

describe("上传图标", () => {
    it("缩图后发 base64 的 PNG；SVG 与非图片原位写原因、不发", async () => {
        const wrapper = await render();
        await choose(new File(["x"], "logo.svg", {type: "image/svg+xml"}));
        expect(document.body.querySelector("[data-icon-error]")?.textContent).toContain("不收 SVG");
        await choose(new File(["x"], "notes.txt", {type: "text/plain"}));
        expect(document.body.querySelector("[data-icon-error]")?.textContent).toContain("不是图片");
        expect(wrapper.emitted("set-icon")).toBeUndefined();
        await choose(new File(["x"], "logo.png", {type: "image/png"}));
        expect(wrapper.emitted("set-icon")).toEqual([[{kind: "upload", png: btoa(String.fromCharCode(1, 2, 3))}]]);
    });

    it("父组件交回的失败写在面板里；写入中面板的控件停用", async () => {
        await render({iconError: "服务端没有接受这张图：too-large", iconBusy: true});
        expect(document.body.querySelector("[data-icon-error]")?.textContent).toContain("服务端没有接受");
        expect(document.body.querySelector<HTMLInputElement>("[data-icon-file]")?.disabled).toBe(true);
    });
});

describe("改名", () => {
    it("重名在输入框下写原因、不发 rename", async () => {
        const wrapper = mount(ProviderHeader, {global, props: {provider: SAMPLE_PROVIDERS[0], takenNames: new Set(["anthropic"])}, attachTo: document.body});
        mounted.push(wrapper);
        document.body.querySelector<HTMLButtonElement>("[data-provider-rename]")!.click();
        await flushPromises();
        const input = document.body.querySelector<HTMLInputElement>("input[data-provider-name-input], [data-provider-name-input] input")!;
        input.value = "Anthropic";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        await flushPromises();
        expect(document.body.querySelector("[data-name-problem]")?.textContent).toContain("已有同名服务商");
        expect(wrapper.emitted("rename")).toBeUndefined();
    });
});
