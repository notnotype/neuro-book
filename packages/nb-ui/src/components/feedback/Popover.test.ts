/** Popover（同名 .md）锚在外部元素上：开关只看 `open`；Escape 关掉后焦点回到锚点；在锚点上按下不算点外面；`label` 是对话框的可读名字。 */
import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, nextTick, ref, shallowRef} from "vue";

import Popover from "./Popover.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

/** 像调用方那样：自己渲染锚点按钮、自己持有 `open`，点锚点切换。 */
function mountAnchored() {
    const open = ref(false);
    const anchor = shallowRef<HTMLElement | null>(null);
    const Host = defineComponent({
        setup() {
            return () => [
                h("button", {ref: anchor, id: "own-id", type: "button", "data-anchor": "", onClick: () => (open.value = !open.value)}, "第三章节奏调整"),
                h(Popover, {open: open.value, anchor: anchor.value, label: "节奏的说明", "onUpdate:open": (value: boolean) => (open.value = value)}, {default: () => h("input", {"data-inside": ""})}),
            ];
        },
    });
    const wrapper = mount(Host, {attachTo: document.body});
    mounted.push(wrapper);
    return {wrapper, open, anchor: () => document.querySelector<HTMLButtonElement>("[data-anchor]")!};
}

async function settle(): Promise<void> {
    for (let index = 0; index < 4; index += 1) await nextTick();
}

describe("Popover 锚在外部元素上", () => {
    it("开关只由 open 决定，不改写锚点的 id 与属性", async () => {
        const {open, anchor} = mountAnchored();
        await settle();
        expect(document.querySelector("[data-inside]")).toBeNull();
        open.value = true;
        await settle();
        expect(document.querySelector("[data-inside]")).not.toBeNull();
        expect(anchor().id).toBe("own-id");
        expect(anchor().hasAttribute("aria-haspopup")).toBe(false);
        // 可读名字写在对话框自己身上。
        expect(document.querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("节奏的说明");
    });

    it("Escape 关掉后焦点回到锚点", async () => {
        const {open, anchor} = mountAnchored();
        open.value = true;
        await settle();
        const inside = document.querySelector<HTMLInputElement>("[data-inside]")!;
        inside.focus();
        inside.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await settle();
        expect(open.value).toBe(false);
        await settle();
        expect(document.activeElement).toBe(anchor());
    });

    it("在锚点上按下不关闭，锚点自己的点击照常切换", async () => {
        const {open, anchor} = mountAnchored();
        open.value = true;
        await settle();
        // 浏览器里按下按钮会先发 pointerdown，再把焦点移到按钮上：两样都不该让浮层关掉。
        anchor().dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        anchor().focus();
        await settle();
        expect(open.value).toBe(true);
        anchor().click();
        await settle();
        expect(open.value).toBe(false);
    });

    it("在别处按下时关闭，焦点不回锚点", async () => {
        const {open, anchor} = mountAnchored();
        const elsewhere = document.createElement("button");
        document.body.append(elsewhere);
        open.value = true;
        await settle();
        elsewhere.focus();
        elsewhere.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        await settle();
        expect(open.value).toBe(false);
        await settle();
        expect(document.activeElement).not.toBe(anchor());
    });
});
