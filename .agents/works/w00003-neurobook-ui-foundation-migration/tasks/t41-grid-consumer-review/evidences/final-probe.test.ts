// @vitest-environment node
/**
 * t41 追加复核探针（临时文件，跑完移回 Task evidences，不留在生产目录）。
 * 只读被审源码：真实 createGrid / layout / resizeBranch / createShellGrid / recalcShellSizes /
 * resizeShellBranch / buildWorkbenchBranchPanels。纯内存，无产品服务、无文件副作用。
 */
import {describe, expect, it} from "vitest";
import {createGrid, type GridAxis, type GridExtent, type GridNodeInput} from "@notnotype/nb-ui/components";
import {constraintsOf, layoutOf, shareAxis} from "../../../../nb-ui/src/components/layout/grid-geometry";
import {createDefaultShellGrid, createShellGrid, recalcShellSizes, resizeShellBranch, SASH_PX, SHELL_LEAF_IDS, SHELL_MAIN_ID, SHELL_TITLEBAR_ID, type ShellSizeStore} from "nbook/app/utils/workbench/layout";
import {buildWorkbenchBranchPanels, workbenchBranchGesture} from "nbook/app/components/workbench/workbench-branch-layout";

const UNBOUNDED = Number.MAX_SAFE_INTEGER;
const failures: string[] = [];

function check(ok: boolean, label: string, detail = ""): void {
    if (!ok) failures.push(`${label}${detail ? ` :: ${detail}` : ""}`);
}

function report(label: string, value: unknown): void {
    console.log(`EVIDENCE ${label} ${JSON.stringify(value)}`);
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function leaf(id: string, axis: GridAxis, intent: number, low: number, high: number): GridNodeInput<string> {
    const along = (value: number): GridExtent => axis === "width" ? {width: value, height: 0} : {width: 0, height: value};
    return {kind: "leaf", id, ref: id, size: along(intent), minimumSize: along(low), maximumSize: along(high)};
}

function branch(axis: GridAxis, children: GridNodeInput<string>[]): GridNodeInput<string> {
    return {kind: "branch", id: "root", orientation: axis === "width" ? "horizontal" : "vertical", size: {width: 0, height: 0}, children};
}

/** 独立参考解：解 sum(clamp(lambda × weight, low, high)) = available（权重全正时可解，单调二分）。 */
function referenceShare(low: number[], high: number[], weight: number[], available: number): number[] {
    let lo = 0;
    let hi = (available + high.reduce((sum, value) => sum + value, 0) + 1) / Math.min(...weight);
    for (let index = 0; index < 200; index += 1) {
        const mid = (lo + hi) / 2;
        const total = low.reduce((sum, value, i) => sum + Math.min(high[i]!, Math.max(value, mid * weight[i]!)), 0);
        if (total < available) lo = mid;
        else hi = mid;
    }
    const lambda = (lo + hi) / 2;
    return low.map((value, i) => Math.min(high[i]!, Math.max(value, lambda * weight[i]!)));
}

describe("t41 追加复核", () => {
    it("P1 shareAxis：确定反例与随机不变量", () => {
        // Leader 12:30 确定反例：可满足约束仍溢出（a=60/0/50, b=30/80/1000, c=10/0/1000，可用 100）
        const overflow = createGrid(branch("width", [leaf("a", "width", 60, 0, 50), leaf("b", "width", 30, 80, 1000), leaf("c", "width", 10, 0, 1000)])).layout({width: 100, height: 100});
        const overflowValues = ["a", "b", "c"].map((id) => overflow.sizes[id]!.width);
        report("P1.leader-overflow", {values: overflowValues, root: overflow.sizes.root!.width, issues: overflow.issues});
        check(overflowValues.reduce((sum, value) => sum + value, 0) <= 100 + 1e-6, "P1 溢出反例：合计超可用");
        check(Math.abs(overflowValues[0]! + overflowValues[1]! + overflowValues[2]! - 100) < 1e-6, "P1 溢出反例：未用完可用空间");
        check(overflow.sizes.root!.width <= 100 + 1e-6, "P1 溢出反例：根超容器");
        check(overflow.issues.length === 0, "P1 溢出反例：可满足却有诊断", overflow.issues.join("|"));

        // 行/列两轴、有 sash、零权重
        const cases: {axis: GridAxis; sash: number; low: number[]; high: number[]; weight: number[]; available: number}[] = [
            {axis: "width", sash: 3, low: [0, 30, 0], high: [20, 100, 10], weight: [80, 15, 5], available: 100},
            {axis: "height", sash: 3, low: [0, 30, 0], high: [20, 100, 10], weight: [80, 15, 5], available: 100},
            {axis: "height", sash: 5, low: [0, 30, 0], high: [40, 100, 100], weight: [0, 0, 0], available: 94},
        ];
        for (const item of cases) {
            const children = item.weight.map((weight, index) => leaf(`n${index}`, item.axis, weight, item.low[index]!, item.high[index]!));
            const along = (available: number): number => item.axis === "width" ? available : available;
            void along;
            const container: GridExtent = item.axis === "width"
                ? {width: item.available + item.sash * (children.length - 1), height: 50}
                : {width: 50, height: item.available + item.sash * (children.length - 1)};
            const result = createGrid(branch(item.axis, children), {sashSize: item.sash}).layout(container);
            const values = children.map((child, index) => result.sizes[`n${index}`]![item.axis]);
            const total = values.reduce((sum, value) => sum + value, 0);
            report(`P1.case-${item.axis}-${item.sash}`, {values, total});
            check(values.every((value, index) => value >= item.low[index]! - 1e-6 && value <= item.high[index]! + 1e-6), "P1 固定用例：越界");
            check(Math.abs(total - item.available) < 1e-6, "P1 固定用例：未守恒");
            check(result.issues.length === 0, "P1 固定用例：有诊断", result.issues.join("|"));
        }

        // 随机：不变量 + 独立参考解 + 兄弟顺序无关
        const random = mulberry32(20260916);
        let referenceMismatch = 0;
        let orderMismatch = 0;
        let firstReferenceMismatch = "";
        let firstOrderMismatch = "";
        for (let round = 0; round < 4000; round += 1) {
            const count = 2 + Math.floor(random() * 4);
            const axis: GridAxis = random() < 0.5 ? "width" : "height";
            const sash = Math.floor(random() * 5);
            const low: number[] = [];
            const high: number[] = [];
            const weight: number[] = [];
            for (let index = 0; index < count; index += 1) {
                const l = Math.floor(random() * 40);
                low.push(l);
                high.push(l + Math.floor(random() * 600));
                weight.push(random() < 0.2 ? 0 : Math.floor(random() * 500));
            }
            const available = 80 + Math.floor(random() * 1200);
            const lowTotal = low.reduce((sum, value) => sum + value, 0);
            const highTotal = high.reduce((sum, value) => sum + value, 0);
            // 只取可满足且不触上限的用例：总量必须能被完全吸收
            if (lowTotal > available || highTotal < available) continue;
            const children = weight.map((value, index) => leaf(`n${index}`, axis, value, low[index]!, high[index]!));
            const container: GridExtent = axis === "width"
                ? {width: available + sash * (count - 1), height: 50}
                : {width: 50, height: available + sash * (count - 1)};
            const result = createGrid(branch(axis, children), {sashSize: sash}).layout(container);
            const values = children.map((child, index) => result.sizes[`n${index}`]![axis]);
            const total = values.reduce((sum, value) => sum + value, 0);
            check(values.every((value, index) => value >= low[index]! - 1e-6 && value <= high[index]! + 1e-6), "P1 随机：越界", JSON.stringify({values, low, high, available}));
            check(Math.abs(total - available) < 1e-4, "P1 随机：未守恒", JSON.stringify({values, total, available, low, high}));
            check(result.issues.length === 0, "P1 随机：有诊断", result.issues.join("|"));
            if (weight.every((value) => value > 0)) {
                const reference = referenceShare(low, high, weight, available);
                const worst = Math.max(...values.map((value, index) => Math.abs(value - reference[index]!)));
                if (worst > 1e-3) {
                    referenceMismatch += 1;
                    if (!firstReferenceMismatch) firstReferenceMismatch = JSON.stringify({axis, sash, available, low, high, weight, values, reference, worst});
                }
            }
            const order = Array.from({length: count}, (_, index) => index).sort(() => random() - 0.5);
            const shuffled = order.map((index) => leaf(`n${index}`, axis, weight[index]!, low[index]!, high[index]!));
            const shuffledResult = createGrid(branch(axis, shuffled), {sashSize: sash}).layout(container);
            const byId = new Map(shuffled.map((child, index) => [child.id, shuffledResult.sizes[child.id]![axis]]));
            const worstOrder = Math.max(...children.map((child, index) => Math.abs(values[index]! - byId.get(child.id)!)));
            if (worstOrder > 1e-3) {
                orderMismatch += 1;
                if (!firstOrderMismatch) firstOrderMismatch = JSON.stringify({axis, sash, available, low, high, weight, values, shuffled: [...byId.values()], worstOrder});
            }
        }
        report("P1.randomized", {referenceMismatch, orderMismatch, firstReferenceMismatch, firstOrderMismatch});
        check(referenceMismatch === 0, "P1 随机：与独立参考解不一致", firstReferenceMismatch);
        check(orderMismatch === 0, "P1 随机：兄弟顺序影响分配", firstOrderMismatch);
    });

    it("P1b resize 的兄弟补偿：意图在界内时守恒且不越界", () => {
        const random = mulberry32(777);
        let worstOutOfBounds = 0;
        let worstNonConserving = 0;
        let sample = "";
        let outOfRangeCases = 0;
        let outOfRangeSample = "";
        for (let round = 0; round < 800; round += 1) {
            const count = 2 + Math.floor(random() * 4);
            const axis: GridAxis = random() < 0.5 ? "width" : "height";
            const low: number[] = [];
            const high: number[] = [];
            const intents: number[] = [];
            for (let index = 0; index < count; index += 1) {
                const l = Math.floor(random() * 30);
                low.push(l);
                high.push(l + 20 + Math.floor(random() * 500));
                intents.push(l + Math.floor(random() * 200));
            }
            const inRange = intents.every((value, index) => value >= low[index]! && value <= high[index]!);
            const children = intents.map((value, index) => leaf(`n${index}`, axis, value, low[index]!, high[index]!));
            const grid = createGrid(branch(axis, children));
            const before = grid.root();
            if (before?.kind !== "branch") throw new Error("需要分支");
            const sumBefore = before.children.reduce((sum, child) => sum + child.size[axis], 0);
            const active = Math.floor(random() * count);
            const delta = Math.round((random() - 0.5) * 400);
            const result = grid.resize(`n${active}`, axis, delta);
            const after = grid.root();
            if (after?.kind !== "branch") throw new Error("需要分支");
            const values = after.children.map((child) => child.size[axis]);
            const sumAfter = values.reduce((sum, value) => sum + value, 0);
            if (!inRange) {
                outOfRangeCases += 1;
                if (!outOfRangeSample) outOfRangeSample = JSON.stringify({axis, intents, low, high, active, delta, values, sumBefore, sumAfter});
                continue;
            }
            if (Math.abs(sumAfter - sumBefore) > 1e-6) {
                worstNonConserving += 1;
                if (!sample) sample = JSON.stringify({axis, intents, low, high, active, delta, sumBefore, sumAfter, applied: result.ok ? result.applied : result.reason});
            }
            const out = values.some((value, index) => value < low[index]! - 1e-6 || value > high[index]! + 1e-6);
            if (out) {
                worstOutOfBounds += 1;
                if (!sample) sample = JSON.stringify({axis, intents, low, high, active, delta, values});
            }
        }
        report("P1b.resize", {worstOutOfBounds, worstNonConserving, sample, outOfRangeCases, outOfRangeSample});
        check(worstOutOfBounds === 0, "P1b resize 越界", sample);
        check(worstNonConserving === 0, "P1b resize 意图总量不守恒", sample);
    });

    it("P3 resizeBranch：同容器精确复现、viewer 缩放闭环、失败不改树", () => {
        const VIEWPORT = 1280;
        const HEIGHT = 900;
        const shellSizes = {activity: 60, left: 340, editor: 478, right: 400, titlebar: 36, main: 864};
        const container: GridExtent = {width: VIEWPORT, height: HEIGHT};
        /** 每个手势用自己的新树：基线必须与当前呈现一一对应，否则后一次提交自然报「基线已失效」。 */
        const freshShell = (width = VIEWPORT, sizes: Record<string, number> = shellSizes) => {
            const grid = createShellGrid(width, sizes);
            const layout = grid.layout({width, height: HEIGHT});
            const root = grid.root();
            const main = root?.kind === "branch" ? root.children.find((child) => child.id === SHELL_MAIN_ID) : null;
            if (main?.kind !== "branch") throw new Error("需要主分支");
            const baseline = Object.fromEntries(main.children.map((child) => [child.id, layout.sizes[child.id]!.width]));
            return {grid, main, baseline};
        };

        const outcomes: Record<string, unknown> = {};
        for (let index = 0; index + 1 < 4; index += 1) {
            for (const delta of [4, -4, 37, -37, 200, -200, 900]) {
                const {grid, main, baseline} = freshShell();
                const a = main.children[index]!.id;
                const b = main.children[index + 1]!.id;
                const target = {...baseline};
                target[a] = Math.max(0, baseline[a]! + delta);
                target[b] = Math.max(0, baseline[b]! - delta);
                const result = grid.resizeBranch(SHELL_MAIN_ID, "width", baseline, target);
                if (!result.ok) {
                    outcomes[`${a}|${b}:${delta}`] = {rejected: result.reason};
                    continue;
                }
                const presented = grid.layout(container).sizes;
                outcomes[`${a}|${b}:${delta}`] = {
                    target: [target[a], target[b]],
                    presented: [presented[a]!.width, presented[b]!.width],
                    diff: Math.round(Math.max(Math.abs(presented[a]!.width - target[a]!), Math.abs(presented[b]!.width - target[b]!)) * 1000) / 1000,
                };
            }
        }
        report("P3.same-container", outcomes);
        const accepted = Object.values(outcomes).filter((value): value is {diff: number} => typeof value === "object" && value !== null && "diff" in value);
        check(accepted.length >= 8, "P3 合法手势被拒太多", JSON.stringify(outcomes));
        check(accepted.every((value) => value.diff <= 0.5), "P3 同容器呈现与手势目标不一致", JSON.stringify(accepted.filter((value) => value.diff > 0.5)));

        // 容器缩放：容器 1000 时右栏上限 450，拖到界内必须精确复现，再拖一次仍闭环
        const scaledContainer: GridExtent = {width: 1000, height: HEIGHT};
        const scaledModel = recalcShellSizes(createDefaultShellGrid(1000, HEIGHT), {leftPanelWidth: 340, agentPanelWidth: 400, hidden: []}, 998).sizes;
        const scaled = freshShell(1000, {...shellSizes, ...scaledModel});
        const scaledTarget = {...scaled.baseline, editor: scaled.baseline.editor! - 30, right: scaled.baseline.right! + 30};
        const scaledResult = scaled.grid.resizeBranch(SHELL_MAIN_ID, "width", scaled.baseline, scaledTarget);
        const afterScale = scaled.grid.layout(scaledContainer);
        const intents = scaled.main.children.map((child) => [child.id, Math.round(child.size.width * 100) / 100]);
        const presentedAfterScale = Object.fromEntries(["activity", "left", "editor", "right"].map((id) => [id, Math.round(afterScale.sizes[id]!.width * 100) / 100]));
        const closedBaseline = Object.fromEntries(scaled.main.children.map((child) => [child.id, afterScale.sizes[child.id]!.width]));
        const closedTarget = {...closedBaseline, left: closedBaseline.left! + 25, editor: closedBaseline.editor! - 25};
        const closed = scaled.grid.resizeBranch(SHELL_MAIN_ID, "width", closedBaseline, closedTarget);
        const closedPresented = scaled.grid.layout(scaledContainer).sizes;
        report("P3.scaled", {
            ok: scaledResult.ok,
            baseline: scaled.baseline,
            target: scaledTarget,
            presented: presentedAfterScale,
            intents,
            closed: {ok: closed.ok, left: closedPresented.left!.width, targetLeft: closedTarget.left, editor: closedPresented.editor!.width, targetEditor: closedTarget.editor},
        });
        check(scaledResult.ok, "P3 缩放容器手势被拒", scaledResult.ok ? "" : scaledResult.reason);
        check(Math.abs(afterScale.sizes.right!.width - scaledTarget.right!) <= 0.5, "P3 缩放容器呈现未命中目标", JSON.stringify(presentedAfterScale));
        check(closed.ok, "P3 闭环手势被拒");
        check(Math.abs(closedPresented.left!.width - closedTarget.left!) <= 0.5 && Math.abs(closedPresented.editor!.width - closedTarget.editor!) <= 0.5, "P3 闭环未命中目标", JSON.stringify({left: closedPresented.left!.width, editor: closedPresented.editor!.width}));

        // Shell 产品闭环：手势 → store → recalcShellSizes → createShellGrid → layout（同容器、受限视口）
        const pipeline: Record<string, unknown> = {};
        for (const width of [1280, 1000, 900]) {
            const model = recalcShellSizes(createDefaultShellGrid(width, HEIGHT), {leftPanelWidth: 340, agentPanelWidth: 400, hidden: []}, width - 2).sizes;
            const {grid, baseline} = freshShell(width, {...shellSizes, ...model});
            const target = {...baseline, editor: baseline.editor! - 30, right: baseline.right! + 30};
            const store = {leftPanelWidth: 340, agentPanelWidth: 400, hidden: [] as string[]};
            const commit = resizeShellBranch(grid, SHELL_MAIN_ID, "width", baseline, target, store, ["editor", "right"]);
            if (!commit.ok) {
                pipeline[width] = commit;
                continue;
            }
            const rebuilt = createShellGrid(width, {...recalcShellSizes(grid, commit.store, width - 2).sizes, titlebar: 36, main: HEIGHT - 36});
            const presented = rebuilt.layout({width, height: HEIGHT}).sizes;
            pipeline[width] = {store: commit.store, presented: {left: presented.left!.width, editor: presented.editor!.width, right: presented.right!.width}, target};
            check(Math.abs(presented.right!.width - commit.store.agentPanelWidth) <= 0.5, "P3 Shell 重建后右栏未保持偏好", JSON.stringify({width, presented: presented.right!.width, store: commit.store.agentPanelWidth}));
            check(Math.abs(presented.left!.width - 340) <= 0.5, "P3 Shell 重建后左栏偏离偏好", JSON.stringify({width, presented: presented.left!.width}));
        }
        report("P3.shell-pipeline", pipeline);

        // no-op / 过期基线 / 恶意输入：逐类拒绝且不改树
        const guard = freshShell();
        const guardBaseline = guard.baseline;
        const saved = guard.grid.serialize();
        const noop = guard.grid.resizeBranch(SHELL_MAIN_ID, "width", guardBaseline, {...guardBaseline});
        const noopSnapshot = JSON.stringify(guard.grid.serialize());
        const stale = guard.grid.resizeBranch(SHELL_MAIN_ID, "width", {...guardBaseline, left: guardBaseline.left! + 1}, guardBaseline);
        const extra = guard.grid.resizeBranch(SHELL_MAIN_ID, "width", guardBaseline, {...guardBaseline, ghost: 10});
        const negative = guard.grid.resizeBranch(SHELL_MAIN_ID, "width", guardBaseline, {...guardBaseline, editor: -5, right: guardBaseline.right! + 5});
        const notConserved = guard.grid.resizeBranch(SHELL_MAIN_ID, "width", guardBaseline, {...guardBaseline, editor: guardBaseline.editor! + 10});
        const wrongAxis = guard.grid.resizeBranch(SHELL_MAIN_ID, "height", guardBaseline, guardBaseline);
        const wrongBranch = guard.grid.resizeBranch("activity", "width", guardBaseline, guardBaseline);
        const beyondMax = guard.grid.resizeBranch(SHELL_MAIN_ID, "width", guardBaseline, {...guardBaseline, editor: guardBaseline.editor! - 300, right: guardBaseline.right! + 300});
        const rejectedSnapshot = JSON.stringify(guard.grid.serialize());
        report("P3.guards", {
            noop,
            stale: stale.ok, extra: extra.ok, negative: negative.ok, notConserved: notConserved.ok,
            wrongAxis: wrongAxis.ok, wrongBranch: wrongBranch.ok,
            beyondMax: beyondMax.ok ? beyondMax : beyondMax.reason,
        });
        check(noop.ok, "P3 no-op 被拒");
        check(noopSnapshot === JSON.stringify(saved), "P3 no-op 改动了快照");
        check(!stale.ok && !extra.ok && !negative.ok && !notConserved.ok && !wrongAxis.ok && !wrongBranch.ok && !beyondMax.ok, "P3 非法手势未被拒绝", JSON.stringify({stale, extra, negative, notConserved, wrongAxis, wrongBranch, beyondMax}));
        check(rejectedSnapshot === JSON.stringify(saved), "P3 失败路径改动了树");
    });

    it("P3b 隐藏叶组合下 main 分支的手势基线与 sash 记账一致", () => {
        const VIEWPORT = 1280;
        const HEIGHT = 900;
        const container: GridExtent = {width: VIEWPORT, height: HEIGHT};
        const combos: string[][] = [[], ["activity"], ["left"], ["right"], ["titlebar"], ["activity", "left"], ["left", "right"], ["editor", "titlebar"]];
        const rows: unknown[] = [];
        for (const hidden of combos) {
            const visible = SHELL_LEAF_IDS.filter((id) => !hidden.includes(id));
            if (visible.length < 2) continue;
            const model = recalcShellSizes(createDefaultShellGrid(VIEWPORT, HEIGHT), {leftPanelWidth: 340, agentPanelWidth: 400, hidden}, VIEWPORT - SASH_PX * Math.max(0, visible.length - 1 - (visible[0] === "activity" ? 1 : 0)));
            const sizes = {...model.sizes, titlebar: hidden.includes(SHELL_TITLEBAR_ID) ? 0 : 36, main: hidden.includes(SHELL_TITLEBAR_ID) ? HEIGHT : HEIGHT - 36};
            const grid = createShellGrid(VIEWPORT, sizes, hidden);
            const layout = grid.layout(container);
            const root = grid.root();
            const main = root?.kind === "branch" ? root.children.find((child) => child.id === SHELL_MAIN_ID) : null;
            if (main?.kind !== "branch") throw new Error("需要主分支");
            const presented = main.children.map((child) => layout.sizes[child.id]!.width);
            const sashTotal = (layout.sashSizes[SHELL_MAIN_ID] ?? []).reduce((sum, value) => sum + value, 0);
            const panelSpace = presented.reduce((sum, value) => sum + value, 0);
            const panels = buildWorkbenchBranchPanels(main.children, layout, "width");
            const percentTotal = panels.reduce((sum, panel) => sum + (panel.defaultSize ?? 0), 0);
            rows.push({
                hidden,
                avail: VIEWPORT - SASH_PX * Math.max(0, visible.length - 1 - (visible[0] === "activity" ? 1 : 0)),
                presented: Object.fromEntries(main.children.map((child, index) => [child.id, Math.round(presented[index]! * 100) / 100])),
                model: Object.fromEntries(visible.map((id) => [id, model.sizes[id as (typeof SHELL_LEAF_IDS)[number]]])),
                sashTotal,
                panelSpace,
                branchExtent: layout.sizes[SHELL_MAIN_ID]!.width,
                percentTotal: Math.round(percentTotal * 1000) / 1000,
                issues: layout.issues.length,
            });
            check(Math.abs(panelSpace + sashTotal - layout.sizes[SHELL_MAIN_ID]!.width) < 1e-6, "P3b 面板空间 + sash ≠ 分支呈现", JSON.stringify({hidden, panelSpace, sashTotal}));
            check(Math.abs(percentTotal - 100) < 1e-6, "P3b 面板百分比合计不是 100", JSON.stringify({hidden, percentTotal}));
        }
        report("P3b.hidden-matrix", rows);
        expect(failures).toEqual([]);
    });

    it("P6 Shell 三份口径（模型 / 树 / 呈现）在全部隐藏组合下一致", () => {
        const VIEWPORT = 1280;
        const HEIGHT = 900;
        const container: GridExtent = {width: VIEWPORT, height: HEIGHT};
        const store: ShellSizeStore = {leftPanelWidth: 340, agentPanelWidth: 400, hidden: []};
        const mismatches: unknown[] = [];
        const all: string[] = [SHELL_TITLEBAR_ID, ...SHELL_LEAF_IDS];
        for (let mask = 0; mask < (1 << all.length); mask += 1) {
            const hidden = all.filter((_, index) => (mask & (1 << index)) !== 0);
            const visible = SHELL_LEAF_IDS.filter((id) => !hidden.includes(id));
            const avail = VIEWPORT - SASH_PX * Math.max(0, visible.length - 1 - (visible[0] === "activity" ? 1 : 0));
            const model = recalcShellSizes(createDefaultShellGrid(VIEWPORT, HEIGHT), {...store, hidden}, avail);
            const sizes = {...model.sizes, titlebar: hidden.includes(SHELL_TITLEBAR_ID) ? 0 : 36, main: hidden.includes(SHELL_TITLEBAR_ID) ? HEIGHT : HEIGHT - 36};
            const grid = createShellGrid(VIEWPORT, sizes, hidden);
            const layout = grid.layout(container);
            const diff: Record<string, number> = {};
            for (const id of visible) {
                diff[id] = Math.round((layout.sizes[id]!.width - model.sizes[id as (typeof SHELL_LEAF_IDS)[number]]) * 100) / 100;
            }
            const worst = Math.max(0, ...Object.values(diff).map(Math.abs));
            if (worst > 0.5) {
                mismatches.push({hidden, avail, model: model.sizes, presented: Object.fromEntries(visible.map((id) => [id, Math.round(layout.sizes[id]!.width * 100) / 100])), diff, modelIssues: model.issues, layoutIssues: layout.issues});
            }
        }
        report("P6.hidden-subset-mismatches", mismatches);
        expect(failures).toEqual([]);
    });

    it("P4 渲染器投影：布局两叶 max100 / 容器 500 的当前行为", () => {
        const grid = createGrid<string>(branch("width", [leaf("a", "width", 100, 0, 100), leaf("b", "width", 100, 0, 100)]), {sashSize: 0});
        const layout = grid.layout({width: 500, height: 300});
        const root = grid.root();
        if (root?.kind !== "branch") throw new Error("需要分支");
        const panels = buildWorkbenchBranchPanels(root.children, layout, "width");
        const gesture = workbenchBranchGesture(root.children, layout, "width", panels.map((panel) => panel.defaultSize!));
        report("P4.two-leaf-100-500", {
            sizes: layout.sizes,
            branchExtent: layout.sizes.root,
            issues: layout.issues,
            panels,
            gesture,
        });
        check(Math.abs(layout.sizes.root!.width - 200) < 1e-6, "P4 分支呈现应为两叶 max 之和 200", String(layout.sizes.root!.width));
        check(layout.issues.length > 0, "P4 全触 max 未报未吸收");
        // 面板百分比合计 100 ⇒ 父容器 500 里渲染 250/250，与 grid 的 100/100 不一致（t37 未收口项）
        check(Math.abs(panels[0]!.defaultSize! - 50) < 1e-6, "P4 面板百分比假设变了", JSON.stringify(panels));
        expect(failures).toEqual([]);
    });

    it("P5 泛型 ref 的稳定编码", () => {
        type Ref = {key: string};
        const refs: Ref[] = [{key: "left"}, {key: "right"}];
        const grid = createGrid<Ref>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: refs.map((ref) => ({kind: "leaf" as const, id: ref.key, ref, size: {width: 50, height: 0}})),
        }, {encodeRef: (ref) => ref.key});
        const saved = grid.serialize();
        report("P5.snapshot", saved);
        const restored = createGrid<Ref>(null, {encodeRef: (ref) => ref.key});
        const restore = restored.restore(saved, (ref) => {
            const value = refs.find((candidate) => candidate.key === ref);
            return value ? {ref: value} : null;
        });
        const root = restored.root();
        const roundTrip = root?.kind === "branch" ? root.children.map((child) => child.kind === "leaf" ? (child.ref === refs[0] ? "left-identity" : child.ref === refs[1] ? "right-identity" : "unknown") : "branch") : [];
        report("P5.round-trip", {ok: restore.ok, roundTrip});
        check(restore.ok && roundTrip.join() === "left-identity,right-identity", "P5 对象 ref 往返丢失身份", JSON.stringify(roundTrip));

        const noEncoder = createGrid<Ref>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [{kind: "leaf", id: "x", ref: {key: "x"}, size: {width: 50, height: 0}}],
        });
        let thrown = "";
        try {
            noEncoder.serialize();
        } catch (error) {
            thrown = error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error);
        }
        report("P5.missing-encoder", thrown);
        check(thrown.startsWith("TypeError"), "P5 缺 encodeRef 未显式抛错", thrown);

        const empty = createGrid<string>(leaf("x", "width", 50, 0, 100));
        let emptyThrown = "";
        try {
            empty.serialize();
        } catch (error) {
            emptyThrown = error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error);
        }
        report("P5.string-ref", {emptyThrown, snapshotRef: createGrid<string>(leaf("x", "width", 50, 0, 100)).serialize()});
        check(emptyThrown === "" || emptyThrown.includes("TypeError"), "P5 字符串 ref 抛错异常");

        // 序列化仍不得泄漏运行期约束
        const withBounds = createGrid<string>(leaf("x", "width", 50, 10, 20));
        report("P5.bounds-not-serialized", JSON.stringify(withBounds.serialize()));
        check(!JSON.stringify(withBounds.serialize()).includes("minimumSize"), "P5 快照含运行期约束");

        // 原语导出面：消费者只用 barrel 也能拿到两轴类型与 axisOf
        report("P5.gesture-helper", workbenchBranchGesture);
        expect(failures).toEqual([]);
    });

    it("P2 Shell 手势落账：只写 active 侧栏", () => {
        const VIEWPORT = 1280;
        const HEIGHT = 900;
        const container: GridExtent = {width: VIEWPORT, height: HEIGHT};
        const store: ShellSizeStore = {leftPanelWidth: 340, agentPanelWidth: 400, hidden: []};
        /** 每个手势都在自己的新树上提交：基线与呈现一一对应，避免前一次提交让后一次基线过期。 */
        const gestureOnFreshGrid = (target: Record<string, number>, active: string[]) => {
            const grid = createDefaultShellGrid(VIEWPORT, HEIGHT);
            const layout = grid.layout(container);
            const root = grid.root();
            const main = root?.kind === "branch" ? root.children.find((child) => child.id === SHELL_MAIN_ID) : null;
            if (main?.kind !== "branch") throw new Error("需要主分支");
            const baseline = Object.fromEntries(main.children.map((child) => [child.id, layout.sizes[child.id]!.width]));
            const result = resizeShellBranch(grid, SHELL_MAIN_ID, "width", baseline, target, store, active);
            return {baseline, result, presented: grid.layout(container).sizes};
        };

        const baseline = gestureOnFreshGrid({}, []).baseline;
        const leftResult = gestureOnFreshGrid({...baseline, left: baseline.left! - 20, editor: baseline.editor! + 20}, ["editor", "left"]);
        const rightResult = gestureOnFreshGrid({...baseline, editor: baseline.editor! - 30, right: baseline.right! + 30}, ["editor", "right"]);
        const compensating = gestureOnFreshGrid({...baseline, left: baseline.left! - 20, editor: baseline.editor! - 30, right: baseline.right! + 50}, ["editor", "right"]);
        const touchOnly = gestureOnFreshGrid({...baseline}, []);
        report("P2.persistence", {
            baseline,
            left: leftResult.result.ok ? leftResult.result.store : leftResult.result,
            right: rightResult.result.ok ? rightResult.result.store : rightResult.result,
            rightPresented: {left: rightResult.presented.left!.width, editor: rightResult.presented.editor!.width, right: rightResult.presented.right!.width},
            compensating: compensating.result.ok ? compensating.result.store : compensating.result,
            touchOnly: touchOnly.result.ok ? touchOnly.result.store : touchOnly.result,
        });
        check(leftResult.result.ok && leftResult.result.store.agentPanelWidth === 400, "P2 左栏手势改写了右栏偏好", JSON.stringify(leftResult.result));
        check(rightResult.result.ok && rightResult.result.store.leftPanelWidth === 340, "P2 右栏手势改写了左栏偏好", JSON.stringify(rightResult.result));
        check(Math.abs(rightResult.presented.right!.width - baseline.right! - 30) < 0.5, "P2 右栏手势呈现未命中目标", JSON.stringify(rightResult.presented.right));
        check(compensating.result.ok && compensating.result.store.leftPanelWidth === 340 && compensating.result.store.agentPanelWidth === 450, "P2 远端补偿被当成偏好", JSON.stringify(compensating.result));
        check(touchOnly.result.ok && touchOnly.result.store.leftPanelWidth === 340 && touchOnly.result.store.agentPanelWidth === 400, "P2 空手势改写了偏好", JSON.stringify(touchOnly.result));
        expect(failures).toEqual([]);
    });

    it("P1c shareAxis / layoutOf 直接导出面可用", () => {
        const low = [0, 30, 0];
        const high = [20, 100, 10];
        const weight = [80, 15, 5];
        const children = weight.map((value, index) => leaf(`n${index}`, "width", value, low[index]!, high[index]!));
        const grid = createGrid(branch("width", children));
        const root = grid.root();
        if (root?.kind !== "branch") throw new Error("需要分支");
        const direct = shareAxis(root.children, "width", 100, 0);
        const viaLayout = layoutOf(root, {width: 100, height: 50}, 0).sizes;
        const bounds = root.children.map((child) => constraintsOf(child, "width", 0));
        report("P1c.direct", {direct, viaLayout: Object.fromEntries(Object.entries(viaLayout).map(([id, value]) => [id, value.width])), bounds, issues: layoutOf(root, {width: 100, height: 50}, 0).issues});
        check(direct.reduce((sum, value) => sum + value, 0) <= 100 + 1e-6, "P1c 直接调用 shareAxis 溢出");
        expect(failures).toEqual([]);
    });
});
