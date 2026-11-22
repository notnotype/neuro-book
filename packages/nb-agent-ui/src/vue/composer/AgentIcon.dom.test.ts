/**
 * 图标引用的画法（同名 .md）：`url` 类按地址画成多色图、加载失败换首字母；`key` 类经解析端口，解析不出画首字母。
 */

import {describe, expect, it} from "vitest";
import {mount} from "@vue/test-utils";
import {defineComponent, h, nextTick} from "vue";

import type {ComposerIcon} from "../../types";
import {provideAgentView} from "../host";
import AgentIcon from "./AgentIcon.vue";

function mountIcon(icon: ComposerIcon) {
    const Host = defineComponent({
        setup() {
            provideAgentView({locale: () => "zh-CN", renderers: () => ({icons: (ref: ComposerIcon) => (ref.kind === "key" && ref.key === "known" ? {kind: "image" as const, src: "/known.svg"} : null)})});
            return () => h(AgentIcon, {icon});
        },
    });
    return mount(Host, {attachTo: document.body});
}

describe("AgentIcon", () => {
    it("url 类直接画图，不经解析端口；图片加载失败后换成 fallback 的首字母块", async () => {
        const wrapper = mountIcon({kind: "url", src: "/api/nbook.models/icons/a.png", fallback: "deepseek"});
        const image = wrapper.find("[data-acv-icon-url]");
        expect(image.attributes("src")).toBe("/api/nbook.models/icons/a.png");
        await image.trigger("error");
        await nextTick();
        expect(wrapper.find("[data-acv-icon-url]").exists()).toBe(false);
        expect(wrapper.text()).toBe("D");
    });

    it("key 类：端口解析得出就画图，解析不出画 fallback 的首字母", () => {
        expect(mountIcon({kind: "key", set: "provider", key: "known", fallback: "Known"}).find("img").attributes("src")).toBe("/known.svg");
        expect(mountIcon({kind: "key", set: "provider", key: "blank-openai", fallback: "我的网关"}).text()).toBe("我");
    });
});
