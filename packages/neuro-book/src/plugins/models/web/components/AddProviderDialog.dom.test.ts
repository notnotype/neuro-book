/**
 * AddProviderDialog（同名 .md）的关闭：自定义服务商表单里，页脚的“返回”退回目录、窗口不关；关闭按钮与 Esc 关窗。
 * 窗口传了 `:close-on-request="false"`，关不关由它自己按关闭原因决定（nb-ui Dialog 的“浮层的打开与关闭”）。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {MODELS_TEXT_NAMESPACE} from "../../shared/text";
import {modelsCatalogs} from "../text";
import type {Template} from "@notnotype/nb-models/contract";

import AddProviderDialog from "./AddProviderDialog.vue";

/** 注入窗口同款的翻译端口（严格模式，缺键或缺参数直接抛错）。 */
const global = {provide: provideText(testTextPort("zh-CN", {[MODELS_TEXT_NAMESPACE]: modelsCatalogs}))};

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const query = <T extends Element>(selector: string): T => {
    const found = document.body.querySelector<T>(selector);
    if (found === null) throw new Error(`没有 ${selector}`);
    return found;
};

const buttonNamed = (name: string): HTMLButtonElement => {
    const found = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label") === name || button.textContent?.trim() === name);
    if (found === undefined) throw new Error(`没有名为 ${name} 的按钮`);
    return found;
};

const TEMPLATES = [
    {id: "deepseek", name: "DeepSeek", group: "china", logo: "deepseek", blank: false, addable: true, reason: null, modelCount: 4, regions: [], routes: [], access: "key"},
    {id: "moonshot", name: "Moonshot", group: "china", logo: "moonshot", blank: false, addable: true, reason: null, modelCount: 17, regions: [{id: "global", baseUrl: "https://api.moonshot.ai/v1"}, {id: "cn", baseUrl: "https://api.moonshot.cn/v1"}], routes: [], access: "key"},
    {id: "ollama", name: "Ollama", group: "other", logo: "ollama", blank: false, addable: true, reason: null, modelCount: 3, regions: [], routes: [], access: "keyless"},
    {id: "anthropic", name: "Anthropic", group: "international", logo: "anthropic", blank: false, addable: false, reason: "login", modelCount: 19, regions: [], routes: [], access: "login"},
    {id: "blank-openai", name: "blank-openai", group: "custom", logo: null, blank: true, addable: true, reason: null, modelCount: 0, regions: [], routes: [], access: "key"},
] as unknown as readonly Template[];

/** 打开窗口。窗口经 Teleport 挂到 body 上，所以查 document.body。 */
async function openDialog(patch: {added?: string[]} = {}) {
    const wrapper = mount(AddProviderDialog, {global, props: {open: true, templates: TEMPLATES, ...patch}, attachTo: document.body});
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

async function openCustomForm() {
    const wrapper = await openDialog();
    query<HTMLButtonElement>("[data-add-provider='blank-openai']").click();
    await flushPromises();
    return wrapper;
}

describe("AddProviderDialog 的第一步", () => {
    it("按分组列出模板：登录类在同一张表里停用并写原因；已添加的不停用、可访问名称带“已添加”；普通模板点一下就发 add", async () => {
        const wrapper = await openDialog({added: ["deepseek"]});
        expect([...document.body.querySelectorAll("[data-add-group]")].map((group) => group.getAttribute("data-add-group"))).toEqual(["international", "china", "other", "custom"]);
        const login = query<HTMLButtonElement>("[data-add-provider='anthropic']");
        expect(login.disabled).toBe(true);
        expect(login.textContent).toContain("要登录");
        const added = query<HTMLButtonElement>("[data-add-provider='deepseek']");
        expect(added.disabled).toBe(false);
        expect(added.getAttribute("aria-label")).toContain("已添加");
        expect(added.textContent).toContain("再添加一份");
        added.click();
        expect(wrapper.emitted("add")).toEqual([[{template: "deepseek"}]]);
    });

    it("搜索按名称与地区名匹配；搜索框里回车选第一个能点的，组字时的回车不算", async () => {
        const wrapper = await openDialog();
        const search = query<HTMLInputElement>("[data-add-provider-search] input, input[data-add-provider-search]");
        search.value = "大陆";
        search.dispatchEvent(new Event("input", {bubbles: true}));
        await flushPromises();
        expect([...document.body.querySelectorAll("[data-add-provider]")].map((row) => row.getAttribute("data-add-provider"))).toEqual(["moonshot"]);
        // 输入法组字时的回车是选字：不选模板。
        search.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true, isComposing: true}));
        await flushPromises();
        expect(document.querySelector("[data-region]")).toBeNull();
        search.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        await flushPromises();
        // 有地区的模板进第二步：选地区。
        query<HTMLInputElement>("[data-region='cn']").click();
        buttonNamed("添加").click();
        await flushPromises();
        expect(wrapper.emitted("add")).toEqual([[{template: "moonshot", region: "cn"}]]);
    });

    it("空白模板进第二步：名称与地址必填、地址要合格才发 add；返回之后焦点回到被点的模板", async () => {
        const wrapper = await openCustomForm();
        buttonNamed("添加").click();
        await flushPromises();
        expect(wrapper.emitted("add")).toBeUndefined();
        query<HTMLInputElement>("[data-field='name'] input, input[data-field='name']").value = "本机";
        query<HTMLInputElement>("[data-field='name'] input, input[data-field='name']").dispatchEvent(new Event("input", {bubbles: true}));
        const url = query<HTMLInputElement>("[data-field='baseUrl'] input, input[data-field='baseUrl']");
        url.value = "http://127.0.0.1:11434/v1";
        url.dispatchEvent(new Event("input", {bubbles: true}));
        buttonNamed("添加").click();
        await flushPromises();
        expect(wrapper.emitted("add")).toEqual([[{template: "blank-openai", name: "本机", baseUrl: "http://127.0.0.1:11434/v1", api: "openai-completions"}]]);
        buttonNamed("返回").click();
        await flushPromises();
        expect(document.activeElement).toBe(query("[data-add-provider='blank-openai']"));
    });
});

describe("AddProviderDialog 的关闭", () => {
    it("页脚的“返回”退回目录，窗口不关", async () => {
        const wrapper = await openCustomForm();
        buttonNamed("返回").click();
        await flushPromises();
        expect(wrapper.emitted("update:open")).toBeUndefined();
        expect(document.body.querySelector("[data-add-provider='blank-openai']")).not.toBeNull();
    });

    it("关闭按钮与 Esc 关窗", async () => {
        const wrapper = await openCustomForm();
        buttonNamed("关闭").click();
        query("[data-dialog-surface]").dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
        await flushPromises();
        expect(wrapper.emitted("update:open")).toEqual([[false], [false]]);
    });
});
