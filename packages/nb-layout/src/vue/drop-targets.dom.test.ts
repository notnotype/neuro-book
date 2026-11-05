import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {defineComponent, h, nextTick, ref} from "vue";

import {defineDropKind} from "../drag-gesture";
import {dropTargetAt, registerDropTarget, useDropTarget} from "./drop-targets";

/** 落点登记（docs/specs/ui/layout-drag.md 输出 16）。 */

const FILE = defineDropKind<{readonly group: string}>("test.file");
const TAB = defineDropKind<{readonly group: string}>("test.tab");

function nested(): {readonly outer: HTMLElement; readonly middle: HTMLElement; readonly leaf: HTMLElement} {
    const outer = document.createElement("div");
    const middle = document.createElement("div");
    const leaf = document.createElement("span");
    middle.append(leaf);
    outer.append(middle);
    return {outer, middle, leaf};
}

describe("dropTargetAt", () => {
    it("从 top 往上找到登记的元素，data 在查询时取", () => {
        const {outer, leaf} = nested();
        let group = "g1";
        registerDropTarget(outer, [FILE], () => ({group}));
        expect(dropTargetAt(leaf, FILE)).toEqual({element: outer, data: {group: "g1"}});
        group = "g2";
        expect(dropTargetAt(leaf, FILE)?.data).toEqual({group: "g2"});
    });

    it("取最近的；内层登记了别的种类不挡外层", () => {
        const {outer, middle, leaf} = nested();
        registerDropTarget(outer, [FILE], () => ({group: "outer"}));
        registerDropTarget(middle, [TAB], () => ({group: "middle"}));
        expect(dropTargetAt(leaf, FILE)?.element).toBe(outer);
        expect(dropTargetAt(leaf, TAB)?.element).toBe(middle);
        registerDropTarget(middle, [FILE], () => ({group: "near"}));
        expect(dropTargetAt(leaf, FILE)?.data).toEqual({group: "near"});
    });

    it("没登记、top 为 null、种类不对都没有落点", () => {
        const {outer, leaf} = nested();
        expect(dropTargetAt(leaf, FILE)).toBeNull();
        expect(dropTargetAt(null, FILE)).toBeNull();
        registerDropTarget(outer, [TAB], () => ({group: "g"}));
        expect(dropTargetAt(leaf, FILE)).toBeNull();
    });

    it("种类按 id 比较：同一个 id 定义两次是同一个种类（热更新重新求值之后）", () => {
        const {outer, leaf} = nested();
        registerDropTarget(outer, [FILE], () => ({group: "g"}));
        expect(dropTargetAt(leaf, defineDropKind<{readonly group: string}>("test.file"))?.element).toBe(outer);
    });

    it("注销之后不再命中，同一元素的其它登记不受影响", () => {
        const {outer, leaf} = nested();
        const off = registerDropTarget(outer, [FILE], () => ({group: "g"}));
        registerDropTarget(outer, [TAB], () => ({group: "g"}));
        off();
        expect(dropTargetAt(leaf, FILE)).toBeNull();
        expect(dropTargetAt(leaf, TAB)?.element).toBe(outer);
    });
});

describe("useDropTarget", () => {
    it("元素出现时登记，换元素时换登记，组件卸载时注销", async () => {
        const which = ref<"a" | "b">("a");
        const element = ref<HTMLElement | null>(null);
        const host = defineComponent({
            setup() {
                useDropTarget(element, [FILE], () => ({group: which.value}));
                return () => h("div", {key: which.value, ref: element, id: which.value});
            },
        });
        const wrapper = mount(host, {attachTo: document.body});
        await nextTick();
        const first = wrapper.element as HTMLElement;
        expect(dropTargetAt(first, FILE)?.data).toEqual({group: "a"});

        which.value = "b";
        await nextTick();
        await nextTick();
        const second = wrapper.element as HTMLElement;
        expect(second).not.toBe(first);
        expect(dropTargetAt(first, FILE)).toBeNull();
        expect(dropTargetAt(second, FILE)?.data).toEqual({group: "b"});

        wrapper.unmount();
        expect(dropTargetAt(second, FILE)).toBeNull();
    });
});
