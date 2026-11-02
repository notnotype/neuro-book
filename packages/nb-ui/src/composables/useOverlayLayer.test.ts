/**
 * 对话框一族的层级（useOverlayLayer）：浮动窗口按嵌套深度往上叠，整条窗口层级带在模态之下；超过 5 层的与第 5 层同档。
 * 层级读的是行内 z-index：happy-dom 不排版，“谁盖住谁”在 e2e/dialog-surfaces.spec.ts 里看。
 */
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {h} from "vue";
import type {VNode} from "vue";

import Dialog from "../components/feedback/Dialog.vue";
import FloatingWindow from "../components/feedback/FloatingWindow.vue";
import QuickPick from "../components/popup/QuickPick.vue";
import {NB_Z_INDEX} from "../theme/z-index";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

/** 一层套一层的浮动窗口，最内层是第 depth 层；每层带 data-depth。 */
function nestedWindows(depth: number, level = 1): VNode {
    return h(FloatingWindow, {"open": true, "title": `第 ${String(level)} 层`, "teleportTarget": false, "showFooter": false, "data-depth": String(level)}, () => (level < depth ? nestedWindows(depth, level + 1) : null));
}

const zIndexOf = (selector: string): number => Number(document.body.querySelector<HTMLElement>(selector)?.style.zIndex);

describe("对话框一族的层级", () => {
    it("窗口按嵌套深度往上叠；超过 5 层的与第 5 层同档，仍在模态之下", async () => {
        mounted.push(mount({render: () => nestedWindows(6)}, {attachTo: document.body}));
        await flushPromises();
        const levels = [1, 2, 3, 4, 5, 6].map((level) => zIndexOf(`[data-depth="${String(level)}"]`));
        expect(levels.slice(0, 5)).toEqual([0, 1, 2, 3, 4].map((step) => NB_Z_INDEX.dialogWindow + step * 2));
        expect(levels[5]).toBe(levels[4]);
        expect(Math.max(...levels)).toBeLessThan(NB_Z_INDEX.dialog);
    });

    it("命令面板不进模态的叠放：在对话框里打开也是固定的命令面板那档，压过对话框与通知", async () => {
        const palette = () => h(QuickPick, {open: true, query: "", items: [{id: "a", label: "打开"}], activeId: "a", title: "命令", placeholder: "输入命令", emptyText: "没有匹配的命令", "data-palette": ""});
        mounted.push(mount({render: () => h(Dialog, {"open": true, "title": "设置", "data-modal": ""}, palette)}, {attachTo: document.body}));
        await flushPromises();
        expect(zIndexOf("[data-palette]")).toBe(NB_Z_INDEX.commandPalette);
        expect(zIndexOf("[data-palette]")).toBeGreaterThan(Math.max(zIndexOf("[data-modal]"), NB_Z_INDEX.notification));
    });

    it("窗口里开的模态压在窗口之上", async () => {
        mounted.push(mount({render: () => h(FloatingWindow, {"open": true, "title": "窗口", "teleportTarget": false, "showFooter": false, "data-window": ""}, () => h(Dialog, {"open": true, "title": "确认", "data-modal": ""}))}, {attachTo: document.body}));
        await flushPromises();
        expect(zIndexOf("[data-modal]")).toBeGreaterThan(zIndexOf("[data-window]"));
    });
});
