/**
 * ImageInput（同名 .md，docs/specs/canon/components.md 输出 15，author-ui.md 输出 53）：两个输入框改出完整的新值；两个都空是未知；
 * 路径不合规则时写原因，服务退回的原因优先。注入了候选与上传时：点一张换成它的路径，上传好换成存下的路径，上传中 Escape 取消、
 * 不往外传。
 */

import {mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {reactive} from "vue";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {CANON_IMAGE_PICKING} from "../../images";
import type {ImagePicking} from "../../images";
import {canonCatalogs} from "../../text";
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

    it("窗口里没有文件服务（没注入，或注入的不可用）时没有候选与上传，只剩手填路径与说明", () => {
        const none = image({});
        const unavailable = mount(ImageInput, {props: {modelValue: null}, global: {provide: {...provideText(port), [CANON_IMAGE_PICKING as symbol]: reactive({available: false, candidates: [], uploading: false, reason: "", notice: "", url: () => null, browse: () => undefined, upload: async () => null, cancel: () => undefined})}}});
        for (const wrapper of [none, unavailable]) {
            expect([wrapper.find("[data-image-upload]").exists(), wrapper.find("[data-image-candidates]").exists(), inputs(wrapper).filter((input) => input.attributes("type") !== "file").length]).toEqual([false, false, 2]);
        }
        unavailable.unmount();
    });

    it("路径不合规则、只填了说明没填路径时写原因；服务退回的原因优先；合规时不写", async () => {
        const wrapper = image({modelValue: {图片: "../外面.png", 说明: ""}});
        expect(wrapper.get("[data-image-problem]").text()).toContain("相对路径");
        await wrapper.setProps({problem: "这个作品里没有这个文件"});
        expect(wrapper.get("[data-image-problem]").text()).toBe("这个作品里没有这个文件");
        await wrapper.setProps({problem: undefined, modelValue: {图片: "", 说明: "星瑕的画像"}});
        expect(wrapper.get("[data-image-problem]").text()).toContain("还要填图片的路径");
        await wrapper.setProps({modelValue: {图片: "图片/星瑕.png", 说明: ""}});
        expect(wrapper.find("[data-image-problem]").exists()).toBe(false);
    });

    it("注入了候选与上传：挂上时重列；点一张换成它的路径；上传好换成存下的路径；上传中焦点留在按钮上，Escape 取消上传、不往外传", async () => {
        const calls: string[] = [];
        let finish: (path: string | null) => void = () => undefined;
        const picking = reactive({
            available: true,
            candidates: [{path: "插图/甲.png", name: "甲.png", url: null}, {path: "插图/乙.png", name: "乙.png", url: null}],
            uploading: false as boolean,
            reason: "",
            notice: "",
            url: () => null,
            browse: () => void calls.push("browse"),
            upload: (file: File) => {
                calls.push(`upload:${file.name}`);
                picking.uploading = true;
                return new Promise<string | null>((resolve) => {
                    finish = (path) => {
                        picking.uploading = false;
                        resolve(path);
                    };
                });
            },
            cancel: () => {
                calls.push("cancel");
                finish(null);
            },
        }) satisfies ImagePicking;
        const wrapper = mount(ImageInput, {props: {modelValue: {图片: "", 说明: "银发"}}, global: {provide: {...provideText(port), [CANON_IMAGE_PICKING as symbol]: picking}}, attachTo: document.body});
        mounted.push(wrapper);
        // 已经有候选也重列（别处可能加了图）。
        expect(calls).toEqual(["browse"]);
        await wrapper.get("[data-image-candidate='插图/乙.png']").trigger("click");
        expect(wrapper.emitted("update:modelValue")!.at(-1)).toEqual([{图片: "插图/乙.png", 说明: "银发"}]);

        wrapper.get<HTMLButtonElement>("[data-image-upload]").element.focus();
        const file = wrapper.get<HTMLInputElement>("[data-image-file]");
        Object.defineProperty(file.element, "files", {value: [new File(["x"], "丙.png", {type: "image/png"})], configurable: true});
        await file.trigger("change");
        expect(calls).toContain("upload:丙.png");
        await waitUntil("上传中", () => wrapper.find("[data-image-cancel]").exists());
        finish("插图/丙 2.png");
        await waitUntil("换成存下的路径", () => JSON.stringify(wrapper.emitted("update:modelValue")!.at(-1)) === JSON.stringify([{图片: "插图/丙 2.png", 说明: "银发"}]));

        await file.trigger("change");
        await waitUntil("又在传", () => wrapper.find("[data-image-cancel]").exists());
        let outside = 0;
        document.body.addEventListener("keydown", () => (outside += 1), {once: true});
        // 按钮换成了“取消上传”，焦点还在它上面：Escape 从焦点所在处发出。
        expect(document.activeElement).toBe(wrapper.get("[data-image-cancel]").element);
        document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        expect(calls.at(-1)).toBe("cancel");
        expect(outside).toBe(0);
    });
});
