import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, ref} from "vue";

import {createGrid} from "../grid";
import {placeGrid} from "../grid-rects";
import type {GridPlacementItem} from "../grid-rects";
import type {GridNodeInput} from "../grid-types";
import {EMPTY_GRID_MOTION_MEMORY, decideMotion, useGridMotion} from "./useGridMotion";
import type {GridMotionFrame, GridMotionMemory} from "./useGridMotion";

/**
 * 要不要过渡（docs/specs/ui/nested-grid.md 的“过渡”）：判定是纯函数，不碰布局，表驱动测。真实布局里的过渡、内容跟不跟外框
 * 在 e2e/lab-grid-structure.e2e.ts。
 */

const leaf = (id: string, width: number): GridNodeInput<string> => ({kind: "leaf", id, ref: id, size: {width, height: 0}});

function items(widths: number[], extent = {width: 700, height: 300}): GridPlacementItem<unknown>[] {
    const root: GridNodeInput<string> = {kind: "branch", id: "root", orientation: "horizontal", children: widths.map((width, index) => leaf(`l${index}`, width))};
    const grid = createGrid<string>(root, {sashSize: 1});
    return [...placeGrid(grid.root()!, grid.layout(extent), extent, 1).items];
}

const EXTENT = {width: 700, height: 300};

function frame(over: Partial<GridMotionFrame> & Pick<GridMotionFrame, "items">): GridMotionFrame {
    return {previous: null, rootSize: EXTENT, extent: EXTENT, dpr: 1, previewing: false, ...over};
}

/** 先喂一次第一帧，让记忆里有真实布局。 */
function warmed(): {memory: GridMotionMemory; base: GridPlacementItem<unknown>[]} {
    const memory = EMPTY_GRID_MOTION_MEMORY();
    const base = items([300, 200, 200]);
    expect(decideMotion(frame({items: base}), memory).kind).toBe("none");
    return {memory, base};
}

describe("decideMotion", () => {
    it("第一次有真实布局：不过渡", () => {
        const memory = EMPTY_GRID_MOTION_MEMORY();
        expect(decideMotion(frame({items: items([300, 200, 200]), previous: items([0, 0, 0])}), memory).kind).toBe("none");
    });

    it("程序改了尺寸：过渡；矩形没变：什么都不做", () => {
        const {memory, base} = warmed();
        expect(decideMotion(frame({items: base, previous: base}), memory).kind).toBe("none");
        expect(decideMotion(frame({items: items([400, 100, 200]), previous: base}), memory).kind).toBe("move");
    });

    it("多了一个叶：过渡，给出新叶第一帧的矩形；还在的叶内容跟外框，新叶不跟", () => {
        const {memory, base} = warmed();
        const decision = decideMotion(frame({items: items([200, 200, 150, 150]), previous: base}), memory);
        expect(decision.kind).toBe("move");
        if (decision.kind !== "move") return;
        expect(decision.entering.has("leaf:l3")).toBe(true);
        expect([...decision.following]).toEqual(["leaf:l0", "leaf:l1", "leaf:l2"]);
    });

    it("容器尺寸变了（宿主的根尺寸或自己量到的盒，两个来源晚一拍到）：不过渡，进行中的直接到终点", () => {
        const {memory, base} = warmed();
        const smaller = {width: 700, height: 250};
        // 第一拍：宿主先发布新布局，自己的盒还是旧的。
        expect(decideMotion(frame({items: items([300, 200, 200], smaller), previous: base, rootSize: smaller}), memory).kind).toBe("stop");
        // 第二拍：自己的盒才更新，矩形又变了（交叉轴）。这一拍不能被当成程序变化。
        const second = decideMotion(frame({items: items([300, 200, 200], smaller), previous: items([300, 200, 200], {width: 700, height: 300}), rootSize: smaller, extent: smaller}), memory);
        expect(second.kind).toBe("stop");
        // 之后稳定了，再来的程序变化照常过渡。
        const settled = items([300, 200, 200], smaller);
        expect(decideMotion(frame({items: items([400, 100, 200], smaller), previous: settled, rootSize: smaller, extent: smaller}), memory).kind).toBe("move");
    });

    it("根尺寸只差舍入（子项加出来的 699.9999999999999）：不算容器变了，照常过渡", () => {
        const {memory, base} = warmed();
        expect(decideMotion(frame({items: items([400, 100, 200]), previous: base, rootSize: {width: 699.9999999999999, height: 300}}), memory).kind).toBe("move");
    });

    it("设备像素比变了：不过渡", () => {
        const {memory, base} = warmed();
        expect(decideMotion(frame({items: items([400, 100, 200]), previous: base, dpr: 1.25}), memory).kind).toBe("stop");
    });

    it("手势预览进行中：不过渡", () => {
        const {memory, base} = warmed();
        expect(decideMotion(frame({items: items([400, 100, 200]), previous: base, previewing: true}), memory).kind).toBe("none");
    });

    it("预览撤下的那一次（松手、取消、被拒）：不过渡；再下一次程序变化照常过渡，不被吞", () => {
        const {memory, base} = warmed();
        const dragged = items([400, 100, 200]);
        decideMotion(frame({items: dragged, previous: base, previewing: true}), memory);
        // 松手落账，预览撤下，布局回到宿主发布的。
        expect(decideMotion(frame({items: dragged, previous: dragged, previewing: false}), memory).kind).toBe("none");
        expect(decideMotion(frame({items: items([200, 300, 200]), previous: dragged}), memory).kind).toBe("move");
    });

    it("预览中发生的结构变化被当成手势：代价只是这一次不过渡，不会残留", () => {
        const {memory, base} = warmed();
        expect(decideMotion(frame({items: items([200, 200, 150, 150]), previous: base, previewing: true}), memory).kind).toBe("none");
        const now = items([200, 200, 150, 150]);
        expect(decideMotion(frame({items: now, previous: now}), memory).kind).toBe("none");
        expect(decideMotion(frame({items: items([300, 100, 150, 150]), previous: now}), memory).kind).toBe("move");
    });
});

describe("过渡中内容跟外框的叶", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    /** 挂一个带令牌的根，喂第一帧。 */
    function started(duration = "470ms") {
        const root = document.createElement("div");
        root.style.setProperty("--motion-layout", duration);
        document.body.append(root);
        let motion!: ReturnType<typeof useGridMotion>;
        const wrapper = mount(defineComponent({
            setup() {
                motion = useGridMotion({root: ref(root), onSettled: () => undefined});
                return () => null;
            },
        }));
        cleanups.push(() => {
            wrapper.unmount();
            root.remove();
        });
        const base = items([300, 200, 200]);
        motion.update(frame({items: base}));
        return {motion, base};
    }
    const followingOf = (motion: ReturnType<typeof useGridMotion>) => [...motion.following.value];

    it("拆分：还在的叶跟，新叶不跟；结束后清空", () => {
        const {motion, base} = started();
        motion.update(frame({items: items([200, 200, 150, 150]), previous: base}));
        expect(motion.moving.value).toBe(true);
        expect(followingOf(motion)).toEqual(["leaf:l0", "leaf:l1", "leaf:l2"]);
        motion.stop();
        expect(motion.moving.value).toBe(false);
        expect(followingOf(motion)).toEqual([]);
    });

    it("过渡中又来一次变化：上一轮的新叶继续不跟；过渡结束之后的变化才跟", () => {
        const {motion, base} = started();
        const split = items([200, 200, 150, 150]);
        motion.update(frame({items: split, previous: base}));
        const again = items([100, 300, 150, 150]);
        motion.update(frame({items: again, previous: split}));
        expect(followingOf(motion)).toEqual(["leaf:l0", "leaf:l1", "leaf:l2"]);
        motion.stop();
        motion.update(frame({items: split, previous: again}));
        expect(followingOf(motion)).toEqual(["leaf:l0", "leaf:l1", "leaf:l2", "leaf:l3"]);
    });

    it("容差之内的第二次发布不改名单", () => {
        const {motion, base} = started();
        const split = items([200, 200, 150, 150]);
        motion.update(frame({items: split, previous: base}));
        motion.update(frame({items: split, previous: split}));
        expect(motion.moving.value).toBe(true);
        expect(followingOf(motion)).toEqual(["leaf:l0", "leaf:l1", "leaf:l2"]);
    });

    it("减少动态效果（令牌为零）：没有过渡，内容直接是最终尺寸", () => {
        const {motion, base} = started("0ms");
        motion.update(frame({items: items([200, 200, 150, 150]), previous: base}));
        expect(motion.moving.value).toBe(false);
        expect(followingOf(motion)).toEqual([]);
    });
});
