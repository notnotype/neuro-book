import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {h} from "vue";

import SortableList from "./SortableList.vue";
import type {SortableMove} from "./useSortable";

/**
 * SortableList 的接线（docs/specs/ui/sortable-list.md 输出 4、5、7）：键盘拖动不靠布局，happy-dom 里走得通，用它验组件经 `@move`
 * 拿到移动、等写入时留住放下的次序。指针拖动、跟手与判定的几何要真实布局，在 `e2e/lab-sortable-list.e2e.ts` 与 `sortable.test.ts`。
 */

const TITLES: Record<string, string> = {c1: "雨夜", c2: "旧码头", c3: "灯塔"};
const SECTIONS = [{id: "v1", title: "第一卷", keys: ["c1", "c2"]}, {id: "v2", title: "第二卷", keys: [] as string[]}];

beforeEach(() => {
    // happy-dom 没有 elementsFromPoint：会话判定时要找指针处最上层的元素，键盘一场里用不到它的结果。
    Object.assign(document, {elementsFromPoint: () => []});
});
afterEach(() => {
    document.body.innerHTML = "";
});

/** 挂上并等一拍：会话在列表根挂上之后才建（`useSortable` 看着根）。 */
async function mountList(onMove: (move: SortableMove) => void | Promise<unknown>, sections = SECTIONS) {
    const wrapper = mount(SortableList, {
        props: {sections, label: (key: string) => TITLES[key] ?? key, onMove},
        slots: {item: ({itemKey}: {itemKey: string}) => h("span", TITLES[itemKey])},
        attachTo: document.body,
    });
    await flushPromises();
    return wrapper;
}
type Mounted = Awaited<ReturnType<typeof mountList>>;
const press = (target: Element, key: string): void => {
    target.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true}));
};
const order = (wrapper: Mounted) => wrapper.findAll("[data-sortable-key]").map((row) => `${row.attributes("data-sortable-section")}:${row.attributes("data-sortable-key")}`);
const handleOf = (wrapper: Mounted, key: string) => wrapper.get(`[data-sortable-key="${key}"] [data-sortable-handle]`).element as HTMLElement;

describe("SortableList", () => {
    it("把手上空格拿起，下键进空的第二卷，回车放下：@move 收到一次移动，焦点回到把手", async () => {
        const moves: SortableMove[] = [];
        const wrapper = await mountList((move) => void moves.push(move));
        expect(wrapper.find('[data-sortable-placeholder][data-sortable-section="v2"]').text()).toBe("拖到这里");
        const handle = handleOf(wrapper, "c2");
        expect(handle.getAttribute("aria-label")).toBe("移动旧码头");
        handle.focus();
        press(handle, " ");
        await flushPromises();
        expect(wrapper.get('[data-sortable-key="c2"]').classes()).toContain("is-held");
        press(handle, "ArrowDown");
        await flushPromises();
        expect(order(wrapper)).toEqual(["v1:c1", "v2:c2"]);
        expect(wrapper.get("[role='status']").text()).toBe("第二卷第 1 位");
        press(handle, "Enter");
        await flushPromises();
        expect(moves).toEqual([{key: "c2", from: {section: "v1", index: 1}, to: {section: "v2", index: 0}}]);
        expect(wrapper.get("[role='status']").text()).toBe("已把旧码头放到第二卷第 1 位");
    });

    it("回到原位不调 @move；Esc 回原样", async () => {
        const moves: SortableMove[] = [];
        const wrapper = await mountList((move) => void moves.push(move));
        const handle = handleOf(wrapper, "c1");
        handle.focus();
        press(handle, " ");
        press(handle, "ArrowDown");
        await flushPromises();
        expect(order(wrapper)).toEqual(["v1:c2", "v1:c1"]);
        press(handle, "Escape");
        await flushPromises();
        expect(order(wrapper)).toEqual(["v1:c1", "v1:c2"]);
        press(handle, " ");
        press(handle, "Enter");
        await flushPromises();
        expect(moves).toEqual([]);
    });

    it("@move 返回的 Promise 没 settle 时，放下的次序留着、不能再拿起；settle 后跟着 sections（宿主没采纳就回到原样）", async () => {
        let settle: () => void = () => undefined;
        const wrapper = await mountList(() => new Promise<void>((resolve) => { settle = resolve; }));
        const handle = handleOf(wrapper, "c1");
        handle.focus();
        press(handle, " ");
        press(handle, "ArrowDown");
        press(handle, "Enter");
        await flushPromises();
        expect(order(wrapper)).toEqual(["v1:c2", "v1:c1"]);
        press(handleOf(wrapper, "c2"), " ");
        await flushPromises();
        expect(wrapper.findAll(".is-held").map((row) => row.attributes("data-sortable-key"))).toEqual([]);
        settle();
        await flushPromises();
        expect(order(wrapper)).toEqual(["v1:c1", "v1:c2"]);
    });

    it("停用时把手停用，空格不拿起", async () => {
        const wrapper = await mountList(() => undefined);
        await wrapper.setProps({disabled: true});
        const handle = handleOf(wrapper, "c1") as HTMLButtonElement;
        expect(handle.disabled).toBe(true);
        press(handle, " ");
        await flushPromises();
        expect(wrapper.find(".is-held").exists()).toBe(false);
    });
});
