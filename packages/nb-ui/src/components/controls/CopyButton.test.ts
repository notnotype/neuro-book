/**
 * CopyButton 的复制回执（CopyButton.md 的“交互”）。
 *
 * happy-dom 有真实的 `navigator.clipboard`（写进去能读回来），没有 `document.execCommand`；
 * 所以这里覆盖“剪贴板可用”与“两条路都不通”，execCommand 退路由 Lab 的 e2e 在真实浏览器里验证。
 * 非安全上下文用“把 navigator.clipboard 定义成 undefined”模拟：真实浏览器在 http 页面上就是这个样子。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";

import CopyButton from "./CopyButton.vue";

const mounted: {unmount: () => void}[] = [];

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    // 去掉实例上的覆盖，回到 happy-dom 原型上的真实剪贴板。
    Reflect.deleteProperty(navigator, "clipboard");
});

function mountButton(props: {text: string; resetAfter?: number; label?: string}) {
    const wrapper = mount(CopyButton, {props, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}

describe("CopyButton", () => {
    it("剪贴板可用时写入完整文字，回执“已复制”，到时回到 idle", async () => {
        const text = "EditorSaveError: EACCES\n    at saveFile (files.ts:88:13)\n\n    trace: 4f2a9c1e";
        // 回执保持 300ms：足够轮询看到 copied，又能在用例里等到它回到 idle。
        const wrapper = mountButton({text, resetAfter: 300});
        expect(wrapper.attributes("data-copy-state")).toBe("idle");
        expect(wrapper.get("button").text()).toBe("复制");

        await wrapper.get("button").trigger("click");
        await vi.waitFor(() => expect(wrapper.attributes("data-copy-state")).toBe("copied"), {interval: 5});
        expect(await navigator.clipboard.readText()).toBe(text);
        expect(wrapper.get("button").text()).toBe("已复制");
        expect(wrapper.get("[role=status]").text()).toBe("已复制");

        await vi.waitFor(() => expect(wrapper.attributes("data-copy-state")).toBe("idle"), {timeout: 3000});
        expect(wrapper.get("[role=status]").text()).toBe("");
    });

    it("没有剪贴板 API、也没有 execCommand 时如实回执失败", async () => {
        Object.defineProperty(navigator, "clipboard", {value: undefined, configurable: true});
        const wrapper = mountButton({text: "原文"});

        await wrapper.get("button").trigger("click");
        await vi.waitFor(() => expect(wrapper.attributes("data-copy-state")).toBe("failed"));
        expect(wrapper.get("button").text()).toBe("复制失败，请手动选择文字");
        expect(wrapper.get("[role=status]").text()).toBe("复制失败，请手动选择文字");
        // 退路用的 textarea 用完就删，不留在组件里。
        expect(wrapper.find("textarea").exists()).toBe(false);
    });

    it("label 只替换 idle 的文字", async () => {
        const wrapper = mountButton({text: "x", label: "复制原文", resetAfter: 60_000});
        expect(wrapper.get("button").text()).toBe("复制原文");
        await wrapper.get("button").trigger("click");
        await vi.waitFor(() => expect(wrapper.get("button").text()).toBe("已复制"));
    });
});
