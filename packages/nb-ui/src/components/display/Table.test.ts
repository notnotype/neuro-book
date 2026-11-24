/**
 * Table 的表头吸顶（Table.md 的“布局与状态”）。
 *
 * happy-dom 不编译原子类、不算布局，吸顶的几何（滚动后表头留在原处）由 Lab 的浏览器测试量
 * （packages/neuro-book/e2e/lab-nb-ui.e2e.ts 的数据表格一条）。这里守结构：谁是滚动容器、表头单元格带不带吸顶，默认时与原来相同。
 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import Table from "./Table.vue";

type Chapter = {title: string; words: number};

const COLUMNS = [
    {key: "title" as const, label: "章节"},
    {key: "words" as const, label: "字数", align: "right" as const},
];
const ROWS: Chapter[] = [{title: "第一章 灯塔", words: 3182}, {title: "第二章 雾中城", words: 4410}];

function classesOf(element: Element): string[] {
    return [...element.classList];
}

/** 根是包住 table 的滚动容器；模板根前有一行注释，wrapper.element 在开发构建里是那个注释节点，所以从 table 往上取。 */
function rootOf(wrapper: {get: (selector: string) => {element: Element}}): Element {
    return wrapper.get("table").element.parentElement!;
}

describe("Table 的 stickyHeader", () => {
    it("默认时根只横向滚动、高度随内容，表头行画下边框，表头单元格不吸顶", () => {
        const wrapper = mount(Table<Chapter>, {props: {columns: COLUMNS, rows: ROWS}});
        const root = classesOf(rootOf(wrapper));
        expect(root).toContain("overflow-x-auto");
        expect(root).not.toContain("overflow-auto");
        expect(root).not.toContain("h-full");
        expect(classesOf(wrapper.get("thead tr").element)).toContain("border-b");
        for (const th of wrapper.findAll("th")) expect(classesOf(th.element)).not.toContain("sticky");
        wrapper.unmount();
    });

    it("为真时根两个方向都滚动并占满父容器的高度，表头单元格吸顶、自带底色与下边线", () => {
        const wrapper = mount(Table<Chapter>, {props: {columns: COLUMNS, rows: ROWS, stickyHeader: true}});
        const root = classesOf(rootOf(wrapper));
        expect(root).toEqual(expect.arrayContaining(["overflow-auto", "h-full", "min-h-0"]));
        expect(root).not.toContain("overflow-x-auto");
        // 下边线由吸顶的单元格自己画，表头行不再画边框，没滚动时不叠成两条。
        expect(classesOf(wrapper.get("thead tr").element)).not.toContain("border-b");
        const headCells = wrapper.findAll("th");
        expect(headCells.map((th) => th.text())).toEqual(["章节", "字数"]);
        for (const th of headCells) {
            expect(classesOf(th.element)).toEqual(expect.arrayContaining(["sticky", "top-0", "bg-[var(--bg-panel)]", "shadow-[inset_0_-1px_0_var(--border-color)]"]));
        }
        // 表体照常：两行数据，对齐不变。
        expect(wrapper.findAll("tbody tr")).toHaveLength(2);
        expect(classesOf(headCells[1]!.element)).toContain("text-right");
        wrapper.unmount();
    });
});
