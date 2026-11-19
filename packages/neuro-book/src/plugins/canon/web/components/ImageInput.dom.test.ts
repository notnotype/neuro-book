/**
 * ImageInput（同名 .md，docs/specs/canon/components.md 输出 15）：两个输入框改出完整的新值；两个都空是未知；路径不合规则时
 * 写原因，服务退回的原因优先。
 */

import {mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../text";
import ImageInput from "./ImageInput.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function image(props: Record<string, unknown>): VueWrapper {
    const wrapper = mount(ImageInput, {props: {modelValue: null, ...props}, global: {provide: provideText(port)}});
    mounted.push(wrapper);
    return wrapper;
}

const inputs = (wrapper: VueWrapper) => wrapper.findAll("input");

describe("ImageInput", () => {
    it("填路径与说明各发出完整的新值；两个都清空时是未知", async () => {
        const wrapper = image({modelValue: {图片: "图片/星瑕.png", 说明: "银发"}});
        await inputs(wrapper)[1]!.setValue("黑发");
        await inputs(wrapper)[0]!.setValue("图片/星瑕2.png");
        expect(wrapper.emitted("update:modelValue")).toEqual([[{图片: "图片/星瑕.png", 说明: "黑发"}], [{图片: "图片/星瑕2.png", 说明: "银发"}]]);
        await wrapper.setProps({modelValue: {图片: "", 说明: "x"}});
        await inputs(wrapper)[1]!.setValue("");
        expect(wrapper.emitted("update:modelValue")!.at(-1)).toEqual([null]);
    });

    it("路径不合规则时写原因；服务退回的原因优先；合规时不写", async () => {
        const wrapper = image({modelValue: {图片: "../外面.png", 说明: ""}});
        expect(wrapper.get("[data-image-problem]").text()).toContain("相对路径");
        await wrapper.setProps({problem: "这个作品里没有这个文件"});
        expect(wrapper.get("[data-image-problem]").text()).toBe("这个作品里没有这个文件");
        await wrapper.setProps({problem: undefined, modelValue: {图片: "图片/星瑕.png", 说明: ""}});
        expect(wrapper.find("[data-image-problem]").exists()).toBe(false);
    });
});
