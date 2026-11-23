import {afterEach, beforeEach, describe, expect, it} from "vitest";

import {layoutMotionMs} from "./layout-motion";
import {layoutDurationMs, readLayoutVar} from "./layout-vars";
import {NB_LAYOUT_THEME_VARS} from "../theme-vars";

/**
 * JS 读变量（docs/specs/ui/nested-grid.md 输出 142）：宿主没给时按清单里的缺省值，与 CSS 每处 `var()` 的回退同值；
 * 时长只认 `ms` 与 `s` 的字面值。公共准备（`vitest.setup.ts`）给每个元素设了 0ms，这里先拿掉，看“宿主没给”。
 */

beforeEach(() => {
    document.head.querySelector("style[data-nb-layout-test-durations]")?.remove();
});
afterEach(() => {
    document.body.innerHTML = "";
});

function element(style: Readonly<Record<string, string>> = {}): HTMLElement {
    const node = document.createElement("div");
    for (const [name, value] of Object.entries(style)) node.style.setProperty(name, value);
    document.body.append(node);
    return node;
}

describe("JS 读 nb-layout 的变量", () => {
    it("宿主没给：时长按缺省（过渡默认是“有”），线芯宽度按 nb-ui 的缺省", () => {
        const node = element();
        expect(layoutMotionMs(node)).toBe(470);
        expect(layoutDurationMs(node, "--nb-layout-motion-move")).toBe(280);
        expect(readLayoutVar(node, "--nb-layout-sash-line-size")).toBe("3px");
    });

    it("宿主没给时库里等过渡收尾读到的时长，就是清单（NB_LAYOUT_THEME_VARS）里 CSS 回退的那个值", () => {
        const entry = NB_LAYOUT_THEME_VARS.find((candidate) => candidate.name === "--nb-layout-motion-layout");
        const fallback = entry?.fallback ?? "";
        // CSS 每处 `var()` 写的回退与清单一致，由 `theme-vars.test.ts` 扫源码；这里接上 JS 这一头。
        expect(fallback).toMatch(/^\d+(?:\.\d+)?m?s$/u);
        const listed = fallback.endsWith("ms") ? Number.parseFloat(fallback) : Number.parseFloat(fallback) * 1000;
        expect(layoutMotionMs(element())).toBe(listed);
    });

    it("宿主给了：ms 与 s 都认；写成别的（none、calc()）当 0", () => {
        expect(layoutMotionMs(element({"--nb-layout-motion-layout": "30ms"}))).toBe(30);
        expect(layoutMotionMs(element({"--nb-layout-motion-layout": "0.2s"}))).toBe(200);
        expect(layoutMotionMs(element({"--nb-layout-motion-layout": "0ms"}))).toBe(0);
        expect(layoutMotionMs(element({"--nb-layout-motion-layout": "none"}))).toBe(0);
        expect(layoutMotionMs(element({"--nb-layout-motion-layout": "calc(100ms * 2)"}))).toBe(0);
    });
});
