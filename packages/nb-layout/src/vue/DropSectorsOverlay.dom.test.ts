import {mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import DropSectorsOverlay from "./DropSectorsOverlay.vue";

/**
 * 落点分区只画宿主给的东西：这里看当前块、字与整层的有无。形状是手写的五块（相对矩形的 0 到 1），左右窄带占 28%，同工作台的分区；
 * 工作台真实算出来的形状画得出来，由 nb-workbench-layout 那边的用例守着。
 */

const wrappers: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

type Sector = {readonly id: string; readonly points: ReadonlyArray<readonly [number, number]>};
const BAND = 0.28;
function fiveSectors(): ReadonlyArray<Sector> {
    const [low, high] = [BAND, 1 - BAND];
    return [
        {id: "left", points: [[0, 0], [low, low], [low, high], [0, 1]]},
        {id: "right", points: [[1, 0], [1, 1], [high, high], [high, low]]},
        {id: "top", points: [[0, 0], [1, 0], [high, low], [low, low]]},
        {id: "bottom", points: [[0, 1], [low, high], [high, high], [1, 1]]},
        {id: "center", points: [[low, low], [high, low], [high, high], [low, high]]},
    ];
}

const LABELS = {left: "左", right: "右", top: "上", bottom: "下", center: "中"};

function show(props: Partial<InstanceType<typeof DropSectorsOverlay>["$props"]>): void {
    wrappers.push(mount(DropSectorsOverlay, {attachTo: document.body, props: {rect: {left: 10, top: 20, right: 610, bottom: 420}, sectors: fiveSectors(), active: null, labels: LABELS, ...props}}));
}
const root = (): Element | null => document.body.querySelector("[data-drop-sectors]");
const labelled = (): Array<string | null> => [...document.body.querySelectorAll("[data-drop-sector-label]")].map((element) => element.getAttribute("data-drop-sector-label")).sort();

describe("DropSectorsOverlay", () => {
    it("没有矩形或没有分区：整层不在", () => {
        show({rect: null});
        expect(root()).toBeNull();
        show({sectors: []});
        expect(root()).toBeNull();
    });

    it("贴在矩形上，不接指针的合同标记与读屏隐藏都在；每块一个多边形", () => {
        show({});
        const element = root() as HTMLElement;
        expect(element.style.left).toBe("10px");
        expect(element.style.width).toBe("600px");
        expect(element.hasAttribute("data-drag-feedback")).toBe(true);
        expect(element.getAttribute("aria-hidden")).toBe("true");
        expect(element.querySelectorAll("[data-drop-sector]")).toHaveLength(5);
    });

    it("当前块有标记，自己不写字", () => {
        show({active: "right"});
        expect(document.body.querySelector("[data-drop-sector-active]")?.getAttribute("data-drop-sector")).toBe("right");
        expect(labelled()).toEqual(["bottom", "center", "left", "top"]);
    });

    it("放不下字的块不写：编辑组最窄时左右窄带约 62px", () => {
        show({rect: {left: 0, top: 0, right: 220, bottom: 120}});
        expect(labelled()).toEqual(["bottom", "center", "top"]);
    });

    it("不给字就不写", () => {
        show({labels: {}});
        expect(labelled()).toEqual([]);
    });
});
