/**
 * ImagePreviewDialog（同名 .md）：关着不读图、标题与下载、复制按钮复制给定文字、显示尺寸的规则（原尺寸、小图放大到 minSize、
 * 放不下等比缩小）。对话框传送到 body，所以从 body 读。尺寸要读浮层宿主的真实大小，happy-dom 里没有排版，
 * 所以尺寸规则经 `previewImageSize` 测，组件里的量取在 e2e（stickers.md 输出 46）。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";

import {captureDialogOrigin} from "./dialog-origin";
import ImagePreviewDialog from "./ImagePreviewDialog.vue";
import {previewImageSize} from "./image-preview-size";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    captureDialogOrigin();
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

async function show(props: {open: boolean; src?: string; downloadName?: string; copyText?: string; copyLabel?: string}) {
    const wrapper = mount(ImagePreviewDialog, {props: {src: "/a.png", alt: "开心 · 星璃", ...props}, attachTo: document.body});
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

describe("ImagePreviewDialog", () => {
    it("关着时不挂图片，不发起读取", async () => {
        await show({open: false});
        expect(document.body.querySelector("img")).toBeNull();
    });

    it("打开：标题是 alt，图片读 src，下载链接指向原始 src", async () => {
        await show({open: true, src: "/image/开心.webp?v=1", downloadName: "开心.webp"});
        expect(document.body.querySelector("[role=dialog]")?.textContent).toContain("开心 · 星璃");
        expect(document.body.querySelector("img")?.getAttribute("src")).toBe("/image/开心.webp?v=1");
        const download = document.body.querySelector<HTMLAnchorElement>("a[download]");
        expect(download?.getAttribute("href")).toBe("/image/开心.webp?v=1");
        expect(download?.getAttribute("download")).toBe("开心.webp");
    });

    it("没给 copyText 时没有复制按钮", async () => {
        await show({open: true});
        expect(document.body.querySelector("[data-image-preview-copy]")).toBeNull();
    });

    it("复制按钮只有图标，名字是 copyLabel，复制给定的文字", async () => {
        await show({open: true, copyText: ":lyra/开心:", copyLabel: "复制写法"});
        const button = document.body.querySelector<HTMLButtonElement>("[data-image-preview-copy] button");
        expect(button?.getAttribute("aria-label")).toBe("复制写法");
        expect(button?.textContent?.trim()).toBe("");
        button!.click();
        await vi.waitFor(() => expect(document.body.querySelector("[data-image-preview-copy]")?.getAttribute("data-copy-state")).toBe("copied"), {interval: 5});
        expect(await navigator.clipboard.readText()).toBe(":lyra/开心:");
        expect(button?.getAttribute("aria-label")).toBe("已复制");
    });

    it("点关闭请求把 open 设为 false", async () => {
        const wrapper = await show({open: true});
        document.body.querySelector<HTMLButtonElement>("[role=dialog] button[aria-label='关闭']")!.click();
        await flushPromises();
        expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    });
});

describe("previewImageSize", () => {
    const roomy = {width: 1000, height: 800};

    it("放得下时是原尺寸，缺省不放大", () => {
        expect(previewImageSize({width: 128, height: 96}, roomy, 0)).toEqual({width: 128, height: 96});
        expect(previewImageSize({width: 512, height: 512}, roomy, 320)).toEqual({width: 512, height: 512});
    });

    it("长边不到 minSize 的按比例放大，长边等于 minSize", () => {
        expect(previewImageSize({width: 128, height: 64}, roomy, 320)).toEqual({width: 320, height: 160});
        expect(previewImageSize({width: 64, height: 128}, roomy, 320)).toEqual({width: 160, height: 320});
    });

    it("放不下时等比缩小，缩小优先于放大", () => {
        expect(previewImageSize({width: 2000, height: 1000}, roomy, 0)).toEqual({width: 1000, height: 500});
        expect(previewImageSize({width: 128, height: 128}, {width: 200, height: 800}, 320)).toEqual({width: 200, height: 200});
    });
});
