/**
 * DetailDialog（同名 .md）：原文按行显示、复制的是完整原文、截断说明、初始焦点与三种关闭。
 * 对话框传送到 body，所以从 body 读。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";

import DetailDialog from "./DetailDialog.vue";
import {captureDialogOrigin} from "./dialog-origin";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    captureDialogOrigin();
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const query = <T extends Element>(selector: string): T => {
    const found = document.body.querySelector<T>(selector);
    if (found === null) throw new Error(`没有 ${selector}`);
    return found;
};

async function open(props: {detail: string; title?: string; truncated?: boolean}) {
    const wrapper = mount(DetailDialog, {props: {open: true, title: props.title ?? "文件没有保存：详情", detail: props.detail, truncated: props.truncated}, attachTo: document.body});
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

describe("DetailDialog", () => {
    it("标题、“诊断原文”与按行拆开的原文；CRLF、LF、单独的 CR 一样拆", async () => {
        await open({detail: "第一行\r\n第二行\n\n第四行\r第五行"});
        expect(query("[role=dialog]").textContent).toContain("文件没有保存：详情");
        expect(query(".nb-code-block__label").textContent).toBe("诊断原文");
        const lines = [...document.body.querySelectorAll(".nb-code-block__text")].map((cell) => cell.textContent);
        expect(lines).toEqual(["第一行", "第二行", "", "第四行", "第五行"]);
        expect(document.body.querySelector(".nb-code-block__note")).toBeNull();
    });

    it("复制的是完整原文，不是拆开后的行", async () => {
        const detail = "EditorSaveError: EACCES\r\n    trace: 4f2a9c1e";
        await open({detail});
        query<HTMLButtonElement>("[data-copy-state] button").click();
        await vi.waitFor(() => expect(query("[data-copy-state]").getAttribute("data-copy-state")).toBe("copied"), {interval: 5});
        expect(await navigator.clipboard.readText()).toBe(detail);
    });

    it("原文被截断时块底写明", async () => {
        await open({detail: "x", truncated: true});
        expect(query(".nb-code-block__note").textContent).toBe("原文过长，已截断");
    });

    it("打开时焦点在正文容器上，不在复制按钮上", async () => {
        await open({detail: "x"});
        expect(document.activeElement).toBe(query("[data-detail-dialog-body]"));
    });

    it("“关闭”、Escape 都发 update:open(false)", async () => {
        const wrapper = await open({detail: "x"});
        const close = [...document.body.querySelectorAll<HTMLButtonElement>("[role=dialog] button")].find((button) => button.textContent?.trim() === "关闭");
        close!.click();
        await flushPromises();
        expect(wrapper.emitted("update:open")).toEqual([[false]]);

        (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
        await flushPromises();
        expect(wrapper.emitted("update:open")).toEqual([[false], [false]]);
    });
});
