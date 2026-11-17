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
import {viewHeadOf} from "../../shared/contracts";
import {useViewInstances} from "./view-instances";
import type {ViewInstances} from "./view-instances";

const Sample = defineComponent({name: "SampleView", render: () => null});

const scopes: EffectScope[] = [];
afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop();
});

function instancesFor(heads: Readonly<Record<string, boolean>>): ViewInstances {
    const ids = new Set(Object.keys(heads));
    const source: ViewSource = {
        delivery: () => ({kind: "available"}),
        load: async (viewId) => ({status: "loaded", component: Sample, ...(heads[viewId] === true ? {head: true} : {})}),
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

    it("没申请的视图没有标题区，它的 context 也取不到", async () => {
        const instances = instancesFor({"test.plain": false});
        await ready(instances, "test.plain");
        expect(instances.headOf("test.plain")).toBeNull();
        expect(viewHeadOf(instances.contextOf("test.plain")!)).toBeNull();
    });
});
