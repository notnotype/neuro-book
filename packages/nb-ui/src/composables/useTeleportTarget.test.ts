/**
 * 居中类浮层的传送目标：宿主提供的目标、组件自己写明的目标、查不到时回到 body。用真实的 Dialog 与 AlertDialog。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, nextTick} from "vue";
import type {Component} from "vue";

import AlertDialog from "../components/feedback/AlertDialog.vue";
import Dialog from "../components/feedback/Dialog.vue";
import {provideTeleportTarget} from "./useTeleportTarget";

const mounted: Array<{unmount(): void}> = [];

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

/** 宿主：先渲染自己的目标元素，再渲染浮层；`provide` 为 null 时不提供目标。 */
function host(overlay: () => ReturnType<typeof h>, provide: string | null): void {
    const target = document.createElement("div");
    target.id = "canvas-overlays";
    document.body.append(target);
    const wrapper = mount(defineComponent({
        setup() {
            if (provide !== null) provideTeleportTarget(provide);
            return overlay;
        },
    }), {attachTo: document.body});
    mounted.push(wrapper);
}

async function settle(): Promise<void> {
    for (let index = 0; index < 4; index += 1) await nextTick();
}

const dialog = (props: Record<string, unknown> = {}) => () => h(Dialog as Component, {modelValue: true, title: "章节属性", ...props}, {default: () => "内容"});

describe("传送目标", () => {
    it("宿主提供了目标：对话框落进目标", async () => {
        host(dialog(), "#canvas-overlays");
        await settle();
        expect(document.querySelector("#canvas-overlays [role=\"dialog\"]")).not.toBeNull();
    });

    it("组件写明的目标优先于宿主提供的", async () => {
        const own = document.createElement("section");
        own.id = "own";
        document.body.append(own);
        host(dialog({teleportTarget: "#own"}), "#canvas-overlays");
        await settle();
        expect(document.querySelector("#own [role=\"dialog\"]")).not.toBeNull();
        expect(document.querySelector("#canvas-overlays [role=\"dialog\"]")).toBeNull();
    });

    it("没有提供或查不到目标时落在 body 上", async () => {
        host(dialog(), "#missing");
        await settle();
        const panel = document.querySelector("[role=\"dialog\"]");
        expect(panel).not.toBeNull();
        expect(document.querySelector("#canvas-overlays [role=\"dialog\"]")).toBeNull();
    });

    it("reka 的 Portal 同样跟随宿主提供的目标（AlertDialog）", async () => {
        host(() => h(AlertDialog as Component, {open: true, title: "删除章节？", confirmText: "删除", cancelText: "取消"}), "#canvas-overlays");
        await settle();
        expect(document.querySelector("#canvas-overlays [role=\"alertdialog\"]")).not.toBeNull();
    });
});
