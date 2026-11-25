/**
 * `ProviderLogo`（同名 .md）：表里有的画图（多色的 `<img>`、单色的着色块），没有的与 `id` 为 null 的画首字母块。地址表按需加载，
 * 图要等它到；首字母块在那之前就画好，表里没有的一直是它（docs/specs/web/settings-page.md 输出 14）。
 */

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import ProviderLogo from "./ProviderLogo.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function logo(props: {id: string | null; name: string}) {
    const wrapper = mount(ProviderLogo, {props});
    mounted.push(wrapper);
    return wrapper;
}

describe("ProviderLogo", () => {
    it("表里没有的、id 为 null 的画名称的首字母（拉丁字母转大写）", () => {
        const unknown = logo({id: "nowhere", name: "博查"});
        expect(unknown.classes()).toContain("provider-logo__initial");
        expect(unknown.text()).toBe("博");
        const none = logo({id: null, name: "  exa"});
        expect(none.classes()).toContain("provider-logo__initial");
        expect(none.text()).toBe("E");
    });

    it("表里有的：多色图画 img，单色图画着色块，不再是首字母", async () => {
        const image = logo({id: "tavily", name: "Tavily"});
        await waitUntil("多色图到了", () => image.element.tagName === "IMG" || undefined, {timeoutMs: 10_000});
        expect(image.classes()).toContain("provider-logo__image");
        const mask = logo({id: "ollama", name: "Ollama"});
        await waitUntil("单色图到了", () => mask.classes().includes("provider-logo__mask") || undefined, {timeoutMs: 10_000});
        expect(mask.text()).toBe("");
    });
});
