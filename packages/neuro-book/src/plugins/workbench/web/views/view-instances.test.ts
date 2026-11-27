/**
 * 视图实例的标题区（docs/specs/workbench/views.md 输出 19）：申请了的实例就绪后才有标题区，视图经 `viewHeadOf(context)` 拿到同一份；
 * 渲染出错时没有，重试渲染换一代、换一份新的；没申请的视图始终没有。来源是满足 `ViewSource` 合同的最小实现，
 * 真实注册表怎样交回 `head` 见 `registry.test.ts`。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {defineComponent, effectScope, shallowRef} from "vue";
import type {EffectScope} from "vue";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {ViewSource} from "./registry";
import {viewHeadOf, viewRailOf} from "../../shared/contracts";
import {useViewInstances} from "./view-instances";
import type {ViewInstances} from "./view-instances";

const Sample = defineComponent({name: "SampleView", render: () => null});

const scopes: EffectScope[] = [];
afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop();
});

/** 每个视图申请了什么：`true` 是标题区，`{band}` 是标题区加自绘头，`{band, head: false}` 是只声明了自绘头（注册表这时不交回它）。 */
function instancesFor(heads: Readonly<Record<string, boolean | {readonly band: number}>>): ViewInstances {
    const ids = new Set(Object.keys(heads));
    const source: ViewSource = {
        delivery: () => ({kind: "available"}),
        load: async (viewId) => {
            const wanted = heads[viewId];
            return {status: "loaded", component: Sample, ...(wanted === true || typeof wanted === "object" ? {head: true} : {}), ...(typeof wanted === "object" ? {ownHead: wanted} : {})};
        },
        retry: async () => ({status: "not-failed"}),
    };
    const scope = effectScope();
    scopes.push(scope);
    const visible = shallowRef<ReadonlySet<string>>(ids);
    return scope.run(() => useViewInstances({source, visible: () => visible.value, placed: () => ids, location: () => "sidebar"}))!;
}

async function ready(instances: ViewInstances, viewId: string): Promise<void> {
    await waitUntil(`${viewId} 就绪`, () => instances.instances.get(viewId)?.status === "ready");
}

describe("视图实例的标题区", () => {
    it("申请了的实例就绪后有标题区，视图经 context 拿到同一份；位置与按下经它交给视图", async () => {
        const instances = instancesFor({"test.head": true});
        await ready(instances, "test.head");
        const control = instances.headOf("test.head");
        expect(control).not.toBeNull();
        const head = viewHeadOf(instances.contextOf("test.head")!);
        expect(head).toBe(control!.head);

        const pressed: string[] = [];
        const stop = head!.onTitlePress(() => pressed.push("pressed"));
        control!.press();
        stop();
        control!.press();
        expect(pressed).toEqual(["pressed"]);

        const slots = {start: {} as HTMLElement, title: {} as HTMLElement, end: {} as HTMLElement, handle: {} as HTMLElement};
        control!.setSlots(slots);
        expect(head!.slots.value).toBe(slots);
        control!.setSlots(null);
        expect(head!.slots.value).toBeNull();
    });

    it("渲染出错时没有标题区；重试渲染换一代，标题区也换一份新的；旧的那份位置清成 null，之后收不到位置与按下", async () => {
        const instances = instancesFor({"test.head": true});
        await ready(instances, "test.head");
        const first = instances.headOf("test.head")!;
        const pressed: string[] = [];
        first.head.onTitlePress(() => pressed.push("old"));
        first.setSlots({start: {} as HTMLElement, title: {} as HTMLElement, end: {} as HTMLElement, handle: {} as HTMLElement});
        const generation = instances.instances.get("test.head")!.generation;
        instances.renderError("test.head", generation, "boom");
        expect(instances.headOf("test.head")).toBeNull();

        instances.retryRender("test.head");
        const second = instances.headOf("test.head");
        expect(second).not.toBeNull();
        expect(second!.head).not.toBe(first.head);
        expect(viewHeadOf(instances.contextOf("test.head")!)).toBe(second!.head);
        second!.setSlots({start: {} as HTMLElement, title: {} as HTMLElement, end: {} as HTMLElement, handle: {} as HTMLElement});
        second!.press();
        expect(first.head.slots.value).toBeNull();
        expect(pressed).toEqual([]);
    });

    it("自绘头（输出 19 的“自绘头”）：声明了的实例就绪后才有，渲染出错时没有（面板头照常写标题），重试渲染后又有；只交给它这一代的标题区，开始与结束经 `ownHead` 告诉视图", async () => {
        const instances = instancesFor({"test.own": {band: 40}, "test.head": true});
        expect(instances.ownHeadOf("test.own")).toBeNull();
        await ready(instances, "test.own");
        await ready(instances, "test.head");
        expect(instances.ownHeadOf("test.own")).toEqual({band: 40});
        expect(instances.ownHeadOf("test.head")).toBeNull();
        const control = instances.headOf("test.own")!;
        expect(control.head.ownHead.value).toBe(false);
        control.setOwnHead(true);
        expect(viewHeadOf(instances.contextOf("test.own")!)!.ownHead.value).toBe(true);

        instances.renderError("test.own", instances.instances.get("test.own")!.generation, "boom");
        expect(instances.ownHeadOf("test.own")).toBeNull();
        instances.retryRender("test.own");
        expect(instances.ownHeadOf("test.own")).toEqual({band: 40});
        // 换代后是新的一份，从“没有自绘”开始，由外壳再写。
        expect(instances.headOf("test.own")!.head.ownHead.value).toBe(false);
    });

    it("没申请的视图没有标题区，它的 context 也取不到", async () => {
        const instances = instancesFor({"test.plain": false});
        await ready(instances, "test.plain");
        expect(instances.headOf("test.plain")).toBeNull();
        expect(viewHeadOf(instances.contextOf("test.plain")!)).toBeNull();
    });
});

describe("视图实例的视图段（views.md 输出 21）", () => {
    const BOUNDS = {width: 260, minimum: 200, maximum: 420, chatMinimum: 320};
    /** `requested` 记下转给外壳的请求；外壳按 `answer` 回。 */
    function railInstances(answer: (expanded: boolean) => "done" | "too-narrow" = () => "done") {
        const requested: boolean[] = [];
        const source: ViewSource = {
            delivery: () => ({kind: "available"}),
            load: async (viewId) => ({status: "loaded", component: Sample, ...(viewId === "test.rail" ? {rail: BOUNDS} : {})}),
            retry: async () => ({status: "not-failed"}),
        };
        const scope = effectScope();
        scopes.push(scope);
        const ids = new Set(["test.rail", "test.plain"]);
        const instances = scope.run(() => useViewInstances({source, visible: () => ids, placed: () => ids, location: () => "auxiliarybar", requestRail: (_viewId, expanded) => {
            requested.push(expanded);
            return answer(expanded);
        }}))!;
        return {instances, requested};
    }

    it("声明了的实例就绪后有视图段，视图经 context 拿到同一份；请求转给外壳、按调用顺序各自完成；没声明的没有", async () => {
        let narrow = false;
        const {instances, requested} = railInstances(() => (narrow ? "too-narrow" : "done"));
        await ready(instances, "test.rail");
        await ready(instances, "test.plain");
        const control = instances.railOf("test.rail");
        expect(control).not.toBeNull();
        const rail = viewRailOf(instances.contextOf("test.rail")!);
        expect(rail).toBe(control!.rail);
        expect(rail!.placement.value).toEqual({kind: "none"});
        const first = rail!.request(true);
        narrow = true;
        const second = rail!.request(false);
        expect(await Promise.all([first, second])).toEqual(["done", "too-narrow"]);
        expect(requested).toEqual([true, false]);
        expect(instances.railOf("test.plain")).toBeNull();
        expect(viewRailOf(instances.contextOf("test.plain")!)).toBeNull();
    });

    it("浮动窗与侧轨的位置：宽、“窗口太窄”与元素都相同时不换引用（视图的 watch 不重跑），任一项变了就换（workbench-layout 输出 50、51）", async () => {
        const {instances} = railInstances();
        await ready(instances, "test.rail");
        const control = instances.railOf("test.rail")!;
        control.setPlacement({kind: "window", width: 260, tooNarrow: false});
        const first = control.rail.placement.value;
        control.setPlacement({kind: "window", width: 260, tooNarrow: false});
        expect(control.rail.placement.value).toBe(first);
        control.setPlacement({kind: "window", width: 260, tooNarrow: true});
        expect(control.rail.placement.value).toEqual({kind: "window", width: 260, tooNarrow: true});
        control.setPlacement({kind: "window", width: 300, tooNarrow: true});
        expect(control.rail.placement.value).toEqual({kind: "window", width: 300, tooNarrow: true});

        // 侧轨的位置同样：同一对元素、同样的宽与“窗口太窄”不换引用；宽变了（拖轨宽）或换了元素就换。元素只比身份，这里用两个普通对象代替。
        const main = {} as HTMLElement;
        const foot = {} as HTMLElement;
        control.setPlacement({kind: "rail", main, foot, width: 48, tooNarrow: false});
        const docked = control.rail.placement.value;
        control.setPlacement({kind: "rail", main, foot, width: 48, tooNarrow: false});
        expect(control.rail.placement.value).toBe(docked);
        control.setPlacement({kind: "rail", main, foot, width: 300, tooNarrow: false});
        expect(control.rail.placement.value).not.toBe(docked);
        const wide = control.rail.placement.value;
        control.setPlacement({kind: "rail", main: {} as HTMLElement, foot, width: 300, tooNarrow: false});
        expect(control.rail.placement.value).not.toBe(wide);
    });

    it("渲染出错时旧的那份立即收成 none；重试渲染换一代、换一份新的、请求一律 revoked、不再转给外壳", async () => {
        const {instances, requested} = railInstances();
        await ready(instances, "test.rail");
        const old = instances.railOf("test.rail")!;
        // bun 的测试里没有 DOM：用浮动窗那一种位置，同样只比引用。
        old.setPlacement({kind: "window", width: 260, tooNarrow: false});
        old.setExpanded(true);
        expect(old.rail.placement.value).toEqual({kind: "window", width: 260, tooNarrow: false});
        instances.renderError("test.rail", instances.instances.get("test.rail")!.generation, "boom");
        expect(instances.railOf("test.rail")).toBeNull();
        // 出错的这一代立即退休：外壳只给就绪的实例分发，不在这里收回的话视图还往右轨里送。
        expect(old.rail.placement.value).toEqual({kind: "none"});
        instances.retryRender("test.rail");
        const fresh = instances.railOf("test.rail");
        expect(fresh).not.toBeNull();
        expect(fresh).not.toBe(old);
        expect(old.rail.placement.value).toEqual({kind: "none"});
        expect(old.rail.expanded.value).toBe(false);
        expect(await old.rail.request(true)).toBe("revoked");
        old.setPlacement({kind: "window", width: 300, tooNarrow: false});
        expect(old.rail.placement.value).toEqual({kind: "none"});
        expect(requested).toEqual([]);
    });
});
