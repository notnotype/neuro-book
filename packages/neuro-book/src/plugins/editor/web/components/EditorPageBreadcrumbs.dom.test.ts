/**
 * EditorPageBreadcrumbs（同名 .md，docs/specs/workbench/editor.md 输出 33 的“面包屑”）：哪些段可以点、点了做什么、键盘在可点的
 * 段之间移动、Escape 交还焦点、聚焦请求。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {nextTick} from "vue";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {editorText} from "../../shared/text";
import {editorCatalogs} from "../text";
import EditorPageBreadcrumbs from "./EditorPageBreadcrumbs.vue";

const port = testTextPort("zh-CN", {"nbook.editor": editorCatalogs});

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

function crumbs(focusSeq = 0) {
    const ran: string[] = [];
    const items = [
        {label: "设定", run: () => ran.push("设定")},
        {label: "人物"},
        {label: "星瑕", run: () => ran.push("星瑕")},
        // 最后一段是当前页：带了 run 也不可点。
        {label: "哥哥", run: () => ran.push("哥哥")},
    ];
    const wrapper = mount(EditorPageBreadcrumbs, {props: {items, focusSeq}, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    const segment = (index: number) => wrapper.get(`[data-page-crumb="${String(index)}"]`);
    return {wrapper, ran, segment};
}

describe("EditorPageBreadcrumbs", () => {
    it("带命令的段是按钮，点了执行；没带命令的段与最后一段只是文字，最后一段标成当前页；空数组不渲染", async () => {
        const {wrapper, ran, segment} = crumbs();
        expect(wrapper.get("nav").attributes("aria-label")).toBe(port.t(editorText("crumbs.pageLabel")));
        expect([0, 1, 2, 3].map((index) => segment(index).element.tagName)).toEqual(["BUTTON", "SPAN", "BUTTON", "SPAN"]);
        expect([0, 1, 2, 3].map((index) => segment(index).text())).toEqual(["设定", "人物", "星瑕", "哥哥"]);
        expect(segment(3).attributes("aria-current")).toBe("page");
        expect(segment(1).attributes("aria-current")).toBeUndefined();
        await segment(2).trigger("click");
        await segment(3).trigger("click");
        expect(ran).toEqual(["星瑕"]);

        const empty = mount(EditorPageBreadcrumbs, {props: {items: []}, global: {provide: provideText(port)}});
        mounted.push(empty);
        expect(empty.find("nav").exists()).toBe(false);
    });

    it("键盘：可点的段里只有一段在 Tab 顺序里；左右键、Home、End 在可点的段之间移动，跳过不可点的；Escape 交出 escape", async () => {
        const {wrapper, segment} = crumbs();
        expect([segment(0).attributes("tabindex"), segment(2).attributes("tabindex")]).toEqual(["0", "-1"]);
        (segment(0).element as HTMLElement).focus();
        await segment(0).trigger("keydown", {key: "ArrowRight"});
        expect(document.activeElement).toBe(segment(2).element);
        expect([segment(0).attributes("tabindex"), segment(2).attributes("tabindex")]).toEqual(["-1", "0"]);
        // 已经是最后一个可点的：再按右键不动。
        await segment(2).trigger("keydown", {key: "ArrowRight"});
        expect(document.activeElement).toBe(segment(2).element);
        await segment(2).trigger("keydown", {key: "Home"});
        expect(document.activeElement).toBe(segment(0).element);
        await segment(0).trigger("keydown", {key: "End"});
        expect(document.activeElement).toBe(segment(2).element);
        await segment(2).trigger("keydown", {key: "Escape"});
        expect(wrapper.emitted("escape")).toHaveLength(1);
    });

    it("聚焦请求的序号变了：焦点到最后一个可点的段；一段可点的都没有时不动焦点", async () => {
        const {wrapper, segment} = crumbs();
        await wrapper.setProps({focusSeq: 1});
        await nextTick();
        expect(document.activeElement).toBe(segment(2).element);

        const plain = mount(EditorPageBreadcrumbs, {props: {items: [{label: "设定"}, {label: "星瑕"}], focusSeq: 0}, global: {provide: provideText(port)}, attachTo: document.body});
        mounted.push(plain);
        (segment(0).element as HTMLElement).focus();
        await plain.setProps({focusSeq: 1});
        await nextTick();
        expect(document.activeElement).toBe(segment(0).element);
    });
});
