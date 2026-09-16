import {createSplitterGestureTracker, type SplitterGestureState} from "../packages/nb-ui/src/components/layout/splitter-gesture.ts";

const PANELS = ["activity", "left", "editor", "right"];
// 1280 宽外壳、3 条 1px sash 后的呈现百分比（60 / 340 / 477 / 400）
const BASELINE = [4.6978, 26.6202, 37.3529, 31.3211];
// 拖 editor~right：editor 让 100px 给 right
const DRAGGED = [4.6978, 26.6202, 29.5224, 40.1535];

function run(sashIndex: number, dragged: number[]): SplitterGestureState | null {
    let ended: SplitterGestureState | null = null;
    let cancelled: unknown = null;
    const tracker = createSplitterGestureTracker({
        onStart: () => {},
        onUpdate: () => {},
        onEnd: (state) => { ended = state; },
        onCancel: (info) => { cancelled = info; },
    });
    tracker.setPanelIds(PANELS);
    tracker.setSizes(BASELINE);
    tracker.begin("pointer", sashIndex);
    tracker.setSizes(dragged);
    tracker.end();
    if (cancelled) throw new Error("手势被取消：" + JSON.stringify(cancelled));
    return ended;
}

const rightSash = run(2, DRAGGED);
const leftSash = run(1, [4.6978, 34.4637, 29.5094, 31.3211]);

// WorkbenchBranch.onGestureEnd 的选择规则
const pick = (state: SplitterGestureState | null) => state && PANELS.find((id) => state.active.includes(id));

console.log("editor~right  gesture:", JSON.stringify(rightSash));
console.log("WorkbenchBranch 选中:", pick(rightSash), "（期望 right）");
console.log("left~editor   gesture:", JSON.stringify(leftSash));
console.log("WorkbenchBranch 选中:", pick(leftSash), "（期望 left）");
