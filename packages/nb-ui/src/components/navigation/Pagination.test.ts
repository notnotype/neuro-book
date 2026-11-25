/**
 * Pagination 的格子、事件、读屏与焦点（Pagination.md 的“布局”“交互”“状态与边界”）。
 *
 * 整条宽度与两个箭头的位置不变要量几何，happy-dom 不算布局，由 Lab 的浏览器实测覆盖；这里核对它的前提：
 * 多于 7 页时任何一页都恰好 7 格。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {defineComponent, h, nextTick, ref} from "vue";

import Pagination from "./Pagination.vue";

const mounted: {unmount: () => void}[] = [];

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

function mountPagination(props: {modelValue: number; pageCount: number; disabled?: boolean}) {
    const wrapper = mount(Pagination, {props, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}

/** 页码格与省略号按顺序读出来，省略号记作 "…"；不含两个箭头。 */
function cellTexts(wrapper: ReturnType<typeof mountPagination>): string[] {
    return wrapper.findAll(".nb-pagination-cell").map((cell) => cell.text());
}

function pageButton(wrapper: ReturnType<typeof mountPagination>, page: number) {
    const button = wrapper.findAll("button").find((candidate) => candidate.attributes("aria-label") === `第 ${page} 页`);
    if (!button) throw new Error(`page button ${page} not rendered`);
    return button;
}

const prev = (wrapper: ReturnType<typeof mountPagination>) => wrapper.get("button[aria-label='上一页']");
const next = (wrapper: ReturnType<typeof mountPagination>) => wrapper.get("button[aria-label='下一页']");

describe("Pagination 的格子", () => {
    it("不超过 7 页时列出全部页码", () => {
        expect(cellTexts(mountPagination({modelValue: 1, pageCount: 1}))).toEqual(["1"]);
        expect(cellTexts(mountPagination({modelValue: 3, pageCount: 7}))).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    });

    it.each([
        [1, ["1", "2", "3", "4", "5", "…", "100"]],
        [4, ["1", "2", "3", "4", "5", "…", "100"]],
        [5, ["1", "…", "4", "5", "6", "…", "100"]],
        [50, ["1", "…", "49", "50", "51", "…", "100"]],
        [96, ["1", "…", "95", "96", "97", "…", "100"]],
        [97, ["1", "…", "96", "97", "98", "99", "100"]],
        [100, ["1", "…", "96", "97", "98", "99", "100"]],
    ])("100 页的第 %i 页恰好 7 格", (page, expected) => {
        const wrapper = mountPagination({modelValue: page, pageCount: 100});
        expect(cellTexts(wrapper)).toEqual(expected);
        expect(wrapper.get("[aria-current='page']").text()).toBe(String(page));
    });

    it("8 页时首尾两种折法也是 7 格", () => {
        expect(cellTexts(mountPagination({modelValue: 4, pageCount: 8}))).toEqual(["1", "2", "3", "4", "5", "…", "8"]);
        expect(cellTexts(mountPagination({modelValue: 5, pageCount: 8}))).toEqual(["1", "…", "4", "5", "6", "7", "8"]);
    });

    it("越界的页码按夹到边界的值显示，箭头随之不可用，不发事件", async () => {
        const high = mountPagination({modelValue: 9, pageCount: 3});
        expect(high.get("[aria-current='page']").text()).toBe("3");
        expect(next(high).attributes("disabled")).toBeDefined();
        expect(prev(high).attributes("disabled")).toBeUndefined();

        const low = mountPagination({modelValue: 0, pageCount: 3});
        expect(low.get("[aria-current='page']").text()).toBe("1");
        expect(prev(low).attributes("disabled")).toBeDefined();
        await nextTick();
        expect(high.emitted("update:modelValue")).toBeUndefined();
        expect(low.emitted("update:modelValue")).toBeUndefined();
    });
});

describe("Pagination 的事件", () => {
    it("点与当前不同的页码发出那一页，点当前页不发", async () => {
        const wrapper = mountPagination({modelValue: 50, pageCount: 100});
        await pageButton(wrapper, 50).trigger("click");
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
        await pageButton(wrapper, 51).trigger("click");
        await pageButton(wrapper, 100).trigger("click");
        expect(wrapper.emitted("update:modelValue")).toEqual([[51], [100]]);
    });

    it("箭头发出当前页减一与加一，两端的箭头不可用", async () => {
        const middle = mountPagination({modelValue: 50, pageCount: 100});
        await prev(middle).trigger("click");
        await next(middle).trigger("click");
        expect(middle.emitted("update:modelValue")).toEqual([[49], [51]]);

        const first = mountPagination({modelValue: 1, pageCount: 100});
        expect(prev(first).attributes("disabled")).toBeDefined();
        expect(next(first).attributes("disabled")).toBeUndefined();
        await prev(first).trigger("click");
        expect(first.emitted("update:modelValue")).toBeUndefined();

        const last = mountPagination({modelValue: 100, pageCount: 100});
        expect(next(last).attributes("disabled")).toBeDefined();
        expect(prev(last).attributes("disabled")).toBeUndefined();
    });

    it("整条不可用时页码与箭头都不可用，点了不发", async () => {
        const wrapper = mountPagination({modelValue: 3, pageCount: 5, disabled: true});
        for (const button of wrapper.findAll("button")) expect(button.attributes("disabled")).toBeDefined();
        await pageButton(wrapper, 4).trigger("click");
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    });
});

describe("Pagination 的读屏与键盘", () => {
    it("根是带名字的 nav，当前页可聚焦并带 aria-current，省略号对读屏隐藏且不可聚焦", () => {
        const wrapper = mountPagination({modelValue: 50, pageCount: 100});
        expect(wrapper.element.tagName).toBe("NAV");
        expect(wrapper.attributes("aria-label")).toBe("分页");

        const current = wrapper.get("[aria-current='page']");
        expect(current.element.tagName).toBe("BUTTON");
        expect(current.attributes("aria-label")).toBe("第 50 页");
        expect(wrapper.findAll("[aria-current]")).toHaveLength(1);

        const gaps = wrapper.findAll(".nb-pagination-cell").filter((cell) => cell.text() === "…");
        expect(gaps).toHaveLength(2);
        for (const gap of gaps) {
            expect(gap.attributes("aria-hidden")).toBe("true");
            expect(gap.element.tagName).not.toBe("BUTTON");
            expect(gap.attributes("tabindex")).toBeUndefined();
        }
    });

    it("读屏名字可由属性替换", () => {
        const wrapper = mount(Pagination, {
            props: {modelValue: 2, pageCount: 3, prevLabel: "Back", nextLabel: "Forward", navLabel: "Chapters"},
            attachTo: document.body,
        });
        mounted.push(wrapper);
        expect(wrapper.attributes("aria-label")).toBe("Chapters");
        expect(wrapper.find("button[aria-label='Back']").exists()).toBe(true);
        expect(wrapper.find("button[aria-label='Forward']").exists()).toBe(true);
    });
});

describe("Pagination 的焦点", () => {
    /** 像使用方那样用 v-model 接住页码；`onPage` 可以替使用方改总页数（例如取回来发现数据变少了）。 */
    function mountHost(initial: {page: number; pageCount: number}, onPage?: (page: number, pageCount: {value: number}) => number) {
        const page = ref(initial.page);
        const pageCount = ref(initial.pageCount);
        const outside = document.createElement("button");
        outside.textContent = "outside";
        document.body.append(outside);
        const Host = defineComponent({
            setup: () => () => h(Pagination, {
                modelValue: page.value,
                pageCount: pageCount.value,
                "onUpdate:modelValue": (value: number) => {
                    page.value = onPage ? onPage(value, pageCount) : value;
                },
            }),
        });
        const wrapper = mount(Host, {attachTo: document.body});
        mounted.push(wrapper);
        return {wrapper, page, pageCount, outside};
    }

    const currentButton = () => document.querySelector<HTMLButtonElement>("nav [aria-current='page']");

    it("翻页后焦点所在的按钮被移走时，焦点落到新的当前页", async () => {
        // 在第 50 页点了 51，取回来只剩 3 页，使用方把页码改成 3：刚点的“51”不在了。
        const {wrapper} = mountHost({page: 50, pageCount: 100}, (_page, pageCount) => {
            pageCount.value = 3;
            return 3;
        });
        const clicked = wrapper.findAll("button").find((button) => button.text() === "51")!;
        (clicked.element as HTMLButtonElement).focus();
        expect(document.activeElement).toBe(clicked.element);

        await clicked.trigger("click");
        await vi.waitFor(() => expect(currentButton()?.textContent?.trim()).toBe("3"));
        expect(clicked.element.isConnected).toBe(false);
        await vi.waitFor(() => expect(document.activeElement).toBe(currentButton()));
    });

    it("焦点在“下一页”上连点到末页，箭头变成不可用时焦点落到当前页（末页）", async () => {
        const {wrapper} = mountHost({page: 5, pageCount: 7});
        const nextButton = wrapper.get("button[aria-label='下一页']");
        (nextButton.element as HTMLButtonElement).focus();

        await nextButton.trigger("click");
        await vi.waitFor(() => expect(currentButton()?.textContent?.trim()).toBe("6"));
        expect(document.activeElement).toBe(nextButton.element);

        await nextButton.trigger("click");
        await vi.waitFor(() => expect(currentButton()?.textContent?.trim()).toBe("7"));
        expect(nextButton.attributes("disabled")).toBeDefined();
        await vi.waitFor(() => expect(document.activeElement).toBe(currentButton()));
    });

    it("焦点不在分页条里时，使用方改页码不抢焦点", async () => {
        const {page, outside} = mountHost({page: 50, pageCount: 100});
        outside.focus();
        page.value = 3;
        await vi.waitFor(() => expect(currentButton()?.textContent?.trim()).toBe("3"));
        expect(document.activeElement).toBe(outside);
    });
});
