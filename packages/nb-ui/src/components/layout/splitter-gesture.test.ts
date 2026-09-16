import {describe, expect, it} from "vitest";
import {
    createSplitterGestureTracker,
    type SplitterGestureCancellation,
    type SplitterGestureState,
} from "./splitter-gesture";

/** 记录四个边界的跟踪器夹具：默认面板顺序 [outline, editor, inspector] */
function harness(panelIds = ["outline", "editor", "inspector"], sizes = [28, 52, 20]) {
    const started: SplitterGestureState[] = [];
    const updated: SplitterGestureState[] = [];
    const ended: SplitterGestureState[] = [];
    const cancelled: SplitterGestureCancellation[] = [];
    const tracker = createSplitterGestureTracker({
        onStart: (state) => started.push(state),
        onUpdate: (state) => updated.push(state),
        onEnd: (state) => ended.push(state),
        onCancel: (info) => cancelled.push(info),
    });
    tracker.setPanelIds(panelIds);
    tracker.setSizes(sizes);
    return {tracker, started, updated, ended, cancelled};
}

describe("splitter 手势跟踪器", () => {
    it("开始捕获基线，中途只发更新，结束时提交一次最终意图", () => {
        const fixture = harness();

        fixture.tracker.begin("pointer", 0);
        expect(fixture.started).toEqual([{
            source: "pointer",
            sash: "outline~editor",
            active: [],
            compensated: [],
            sizes: [28, 52, 20],
        }]);

        fixture.tracker.setSizes([33, 47, 20]);
        fixture.tracker.setSizes([38, 42, 20]);
        expect(fixture.updated.map((state) => state.sizes)).toEqual([[33, 47, 20], [38, 42, 20]]);
        expect(fixture.ended).toEqual([]);

        fixture.tracker.end();
        expect(fixture.ended).toEqual([{
            source: "pointer",
            sash: "outline~editor",
            active: ["outline", "editor"],
            compensated: [],
            sizes: [38, 42, 20],
        }]);
        expect(fixture.cancelled).toEqual([]);
    });

    it("相邻面板触界时，把吸收空间的更远面板算作兄弟补偿而不是主动改变", () => {
        // editor 已在 minSize 30：拖动 sash 0 时空间改由 inspector 让出
        const fixture = harness(["outline", "editor", "inspector"], [28, 30, 42]);

        fixture.tracker.begin("pointer", 0);
        fixture.tracker.setSizes([33, 30, 37]);
        fixture.tracker.end();

        expect(fixture.ended).toEqual([{
            source: "pointer",
            sash: "outline~editor",
            active: ["outline"],
            compensated: ["inspector"],
            sizes: [33, 30, 37],
        }]);
    });

    it("键盘连发跨多个 keydown 只结束一次", () => {
        const fixture = harness();

        fixture.tracker.begin("keyboard", 1);
        fixture.tracker.setSizes([28, 62, 10]);
        fixture.tracker.setSizes([28, 72, 0]);
        fixture.tracker.setSizes([18, 82, 0]);
        expect(fixture.started).toHaveLength(1);
        expect(fixture.updated).toHaveLength(3);

        fixture.tracker.end();
        expect(fixture.ended).toHaveLength(1);
        expect(fixture.ended[0]?.source).toBe("keyboard");
        expect(fixture.ended[0]?.sash).toBe("editor~inspector");
        expect(fixture.ended[0]?.sizes).toEqual([18, 82, 0]);
    });

    it("没有改变尺寸的手势按 no-change 收口，不产生提交", () => {
        const fixture = harness();

        fixture.tracker.begin("keyboard", 0);
        fixture.tracker.end();

        expect(fixture.ended).toEqual([]);
        expect(fixture.cancelled).toEqual([{source: "keyboard", sash: "outline~editor", reason: "no-change"}]);
    });

    it("浮点噪声不算用户改变", () => {
        const fixture = harness();

        fixture.tracker.begin("pointer", 0);
        fixture.tracker.setSizes([28 + 1e-12, 52 - 1e-12, 20]);
        fixture.tracker.end();

        expect(fixture.ended).toEqual([]);
        expect(fixture.cancelled[0]?.reason).toBe("no-change");
    });

    it("取消携带来源、sash 与原因，且不发提交", () => {
        const fixture = harness();

        fixture.tracker.begin("pointer", 1);
        fixture.tracker.setSizes([28, 62, 10]);
        fixture.tracker.cancel("escape");

        expect(fixture.cancelled).toEqual([{source: "pointer", sash: "editor~inspector", reason: "escape"}]);
        expect(fixture.ended).toEqual([]);
        expect(fixture.tracker.activeSource).toBeNull();
    });

    it("面板身份变化取消进行中的手势，并在新身份下重新派生 sash", () => {
        const fixture = harness();

        fixture.tracker.begin("pointer", 0);
        fixture.tracker.setSizes([33, 47, 20]);
        fixture.tracker.setPanelIds(["outline", "manuscript", "inspector"]);

        expect(fixture.cancelled).toEqual([{source: "pointer", sash: "outline~editor", reason: "context-changed"}]);
        expect(fixture.ended).toEqual([]);

        fixture.tracker.begin("pointer", 0);
        expect(fixture.started.at(-1)?.sash).toBe("outline~manuscript");
    });

    it("未声明 id 的面板按序号派生稳定身份", () => {
        const fixture = harness([], []);

        fixture.tracker.setPanelIds(["panel-0", "panel-1"]);
        fixture.tracker.begin("keyboard", 0);

        expect(fixture.started.at(-1)?.sash).toBe("panel-0~panel-1");
        expect(fixture.started.at(-1)?.active).toEqual([]);
    });

    it("越界 sash 与空手势外的手势操作不产生事件", () => {
        const fixture = harness();

        fixture.tracker.begin("pointer", 2);
        fixture.tracker.end();
        fixture.tracker.cancel("escape");

        expect(fixture.started).toEqual([]);
        expect(fixture.ended).toEqual([]);
        expect(fixture.cancelled).toEqual([]);
    });

    it("新一次开始会先收口上一次未结束的手势，避免两次手势叠加成一次提交", () => {
        const fixture = harness();

        fixture.tracker.begin("pointer", 0);
        fixture.tracker.setSizes([33, 47, 20]);
        fixture.tracker.begin("keyboard", 1);

        expect(fixture.cancelled).toEqual([{source: "pointer", sash: "outline~editor", reason: "context-changed"}]);
        expect(fixture.ended).toEqual([]);
    });
});
