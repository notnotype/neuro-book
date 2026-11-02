/**
 * AddProviderDialog（同名 .md）的关闭：自定义服务商表单里，页脚的“返回”退回目录、窗口不关；关闭按钮与 Esc 关窗。
 * 窗口传了 `:close-on-request="false"`，关不关由它自己按关闭原因决定（nb-ui Dialog 的“浮层的打开与关闭”）。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {MODELS_TEXT_NAMESPACE} from "../../shared/text";
import {modelsCatalogs} from "../text";
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

/** 打开窗口并进入“自定义服务商”表单。窗口经 Teleport 挂到 body 上，所以查 document.body。 */
async function openCustomForm() {
    const wrapper = mount(AddProviderDialog, {global, props: {open: true, catalog: []}, attachTo: document.body});
    mounted.push(wrapper);
    await flushPromises();
    query<HTMLButtonElement>("[data-add-provider='custom']").click();
    await flushPromises();
    return wrapper;
}

describe("AddProviderDialog 的关闭", () => {
    it("页脚的“返回”退回目录，窗口不关", async () => {
        const wrapper = await openCustomForm();
        buttonNamed("返回").click();
        await flushPromises();
        expect(wrapper.emitted("update:open")).toBeUndefined();
        expect(document.body.querySelector("[data-add-provider='custom']")).not.toBeNull();
    });

    it("关闭按钮与 Esc 关窗", async () => {
        const wrapper = await openCustomForm();
        buttonNamed("关闭").click();
        query("[data-dialog-surface]").dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
        await flushPromises();
        expect(wrapper.emitted("update:open")).toEqual([[false], [false]]);
    });
});
