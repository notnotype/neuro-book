import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h, nextTick, shallowRef, type ShallowRef} from "vue";

import NestedGrid from "./NestedGrid.vue";
import {createGrid, type Grid} from "../grid";
import type {GridGestureCommit} from "../grid-gesture";
import type {GridExtent, GridFailure, GridLayoutResult, GridNode} from "../grid-types";
import {setLayoutDevChecks} from "../dev-checks";
import {useGridHost, type GridHostIssue} from "./useGridHost";

/**
 * 开发模式的配置检查（Spec `ui/nested-grid` 输出 151）：真实的 `NestedGrid` 与 `useGridHost`，手势照真实路径走。
 * happy-dom 没有布局引擎，照 `useGridHost.dom.test.ts` 桩掉布局盒与矩形；`console.warn` 用桩接住、只数次数与内容。
 */

let box: GridExtent = {width: 1000, height: 600};
let warnings: string[] = [];
const wrappers: VueWrapper[] = [];

function twoColumns(sashSize?: number): Grid<string> {
    return createGrid<string>({
        kind: "branch",
        id: "root",
        orientation: "horizontal",
        children: [
            {kind: "leaf", id: "left", ref: "left", size: {width: 300, height: 0}},
            {kind: "leaf", id: "right", ref: "right", size: {width: 500, height: 0}},
        ],
    }, sashSize === undefined ? {} : {sashSize});
}

function pointerEvent(type: string, x: number, y: number): MouseEvent {
    return Object.assign(new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0}), {isPrimary: true, pointerId: 1, pointerType: "mouse"});
}

async function settleFrame(): Promise<void> {
    const {promise, resolve} = Promise.withResolvers<void>();
    requestAnimationFrame(() => resolve());
    await promise;
    await nextTick();
}

/** 在两列之间的分隔条上拖 40px 并松手。 */
async function drag(wrapper: VueWrapper): Promise<void> {
    const sash = wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
    sash.dispatchEvent(pointerEvent("pointerdown", 500.5, 300));
    sash.dispatchEvent(pointerEvent("pointermove", 540.5, 300));
    await settleFrame();
    sash.dispatchEvent(pointerEvent("pointerup", 540.5, 300));
    await nextTick();
    await nextTick();
}

beforeEach(() => {
    box = {width: 1000, height: 600};
    warnings = [];
    // test-lint-allow spy: 接住 console.warn 数次数，开发模式的警告就是要测的输出
    vi.spyOn(console, "warn").mockImplementation((message: unknown) => void warnings.push(String(message)));
    // test-lint-allow spy: 只桩布局盒给出承载盒尺寸；happy-dom 没有布局引擎
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => box.width);
    // test-lint-allow spy: 同上，桩布局盒的高
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => box.height);
    // test-lint-allow spy: 同上，分隔条命中靠矩形
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const sash = this.dataset.sash === "root:0";
        const rect = sash ? {left: 500, top: 0, right: 501, bottom: box.height} : {left: 0, top: 0, right: box.width, bottom: box.height};
        return {...rect, x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top, toJSON: () => ({})} as DOMRect;
    });
    setLayoutDevChecks(true);
});

afterEach(() => {
    for (const wrapper of wrappers.splice(0)) if (wrapper.exists()) wrapper.unmount();
    document.body.innerHTML = "";
    setLayoutDevChecks(false);
    vi.restoreAllMocks();
});

type HostHarness = {
    readonly wrapper: VueWrapper;
    readonly grid: ShallowRef<Grid<string>>;
    readonly context: ShallowRef<string>;
    readonly shown: ShallowRef<boolean>;
    readonly issues: GridHostIssue[];
};

/** 整包绑定的宿主；`overrides` 是模板里另写、盖住包里值的属性（接线错误）。 */
function mountHost(grid: Grid<string>, overrides: Record<string, unknown> = {}): HostHarness {
    const gridRef = shallowRef(grid);
    const context = shallowRef("main");
    const shown = shallowRef(true);
    const issues: GridHostIssue[] = [];
    const Host = defineComponent({
        setup() {
            const host = useGridHost<string>({grid: gridRef, contextKey: () => context.value, onIssues: (list) => void issues.push(...list)});
            return () => h("div", shown.value ? [h(NestedGrid, {...host.bindings.value, ...overrides}, {leaf: (scope: {node: {id: string}}) => h("div", scope.node.id)})] : []);
        },
    });
    const wrapper = mount(Host, {attachTo: document.body});
    wrappers.push(wrapper);
    return {wrapper, grid: gridRef, context, shown, issues};
}

type CommitHandler = (commit: GridGestureCommit) => {readonly ok: true} | GridFailure;

/** 不经 `useGridHost`、直接把属性交给 `NestedGrid`。 */
function mountBare(props: {node: GridNode<string> | null; layout: GridLayoutResult; contextKey?: string; disabled?: boolean; onGestureCommit?: CommitHandler}): VueWrapper {
    const wrapper = mount(NestedGrid, {props, attachTo: document.body, slots: {leaf: (scope: {node: {id: string}}) => h("div", scope.node.id)}});
    wrappers.push(wrapper);
    return wrapper;
}

const ACCEPT = (_commit: GridGestureCommit) => ({ok: true}) as const;

describe("开发模式的配置检查（Spec 输出 151）", () => {
    it("开关关着时，几种接线错误都不警告", async () => {
        setLayoutDevChecks(false);
        const grid = twoColumns();
        mountBare({node: grid.root(), layout: grid.layout(box), onGestureCommit: ACCEPT});
        const wrong = mountHost(twoColumns(1), {contextKey: "other", revision: 0});
        await nextTick();
        await drag(wrong.wrapper);
        expect(warnings).toEqual([]);
    });

    it("分隔条全是 0：接了提交处理、没停用的网格警告一次，重发布局不再警告；只读的、有一条非零分隔条的不警告", async () => {
        const zero = twoColumns();
        const wrapper = mountBare({node: zero.root(), layout: zero.layout(box), onGestureCommit: ACCEPT, contextKey: "zero"});
        await nextTick();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("[nb-layout/NestedGrid]");
        expect(warnings[0]).toContain('"zero"');
        await wrapper.setProps({layout: zero.layout({width: 900, height: 600})});
        expect(warnings).toHaveLength(1);

        mountBare({node: zero.root(), layout: zero.layout(box)});
        mountBare({node: zero.root(), layout: zero.layout(box), onGestureCommit: ACCEPT, disabled: true});
        const sized = twoColumns(1);
        mountBare({node: sized.root(), layout: sized.layout(box), onGestureCommit: ACCEPT});
        // 只有一片叶：没有分隔条，谈不上拖不动。
        const single = createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [{kind: "leaf", id: "only", ref: "only", size: {width: 1, height: 0}}]});
        mountBare({node: single.root(), layout: single.layout(box), onGestureCommit: ACCEPT});
        await nextTick();
        expect(warnings).toHaveLength(1);
    });

    it("没接提交处理：拖一次警告一次，提交照旧以 handler-missing 交出；提交处理返回 undefined 是另一条警告", async () => {
        const grid = twoColumns(1);
        const bare = mountBare({node: grid.root(), layout: grid.layout(box), contextKey: "bare"});
        await nextTick();
        await drag(bare);
        await drag(bare);
        expect(warnings.filter((message) => message.includes("has no onGestureCommit"))).toHaveLength(1);
        const issues = (bare.emitted("issues") ?? []).flatMap((args) => args[0] as GridHostIssue[]);
        expect(issues.map((issue) => issue.code)).toContain("handler-missing");

        const other = twoColumns(1);
        // 类型不对的调用方（例如 JS 里写成了事件）：处理函数什么也不返回。
        const returnsNothing = (() => undefined) as unknown as CommitHandler;
        const wrong = mountBare({node: other.root(), layout: other.layout(box), onGestureCommit: returnsNothing});
        await nextTick();
        await drag(wrong);
        expect(warnings.filter((message) => message.includes("returned undefined"))).toHaveLength(1);
    });

    it("整包绑定后模板里另写了 context-key：按下时警告一次", async () => {
        const harness = mountHost(twoColumns(1), {contextKey: "other"});
        await nextTick();
        await drag(harness.wrapper);
        await drag(harness.wrapper);
        expect(warnings.filter((message) => message.includes("[nb-layout/useGridHost]") && message.includes("contextKey"))).toHaveLength(1);
    });

    it("整包绑定后模板里另写了 revision：缺省的 0 与一个过期的版本都警告", async () => {
        const zero = mountHost(twoColumns(1), {revision: 0});
        await nextTick();
        await drag(zero.wrapper);
        expect(warnings.filter((message) => message.includes("revision 0"))).toHaveLength(1);

        // 过期的版本：大于 0、比宿主此刻的小（宿主挂载、量到尺寸后已经发布过两次以上）。
        const stale = mountHost(twoColumns(1), {revision: 1});
        await nextTick();
        await drag(stale.wrapper);
        expect(warnings.filter((message) => message.includes("revision 1,"))).toHaveLength(1);
    });

    it("正确接线时不误报：拖动、改尺寸、摘掉再挂回、换网格实例、换上下文之后再拖，都没有警告", async () => {
        const harness = mountHost(twoColumns(1));
        await nextTick();
        await drag(harness.wrapper);

        box = {width: 1200, height: 600};
        harness.grid.value = twoColumns(1);
        await nextTick();
        await drag(harness.wrapper);

        harness.shown.value = false;
        await nextTick();
        harness.shown.value = true;
        await nextTick();
        await nextTick();
        await drag(harness.wrapper);

        harness.context.value = "second";
        await nextTick();
        await drag(harness.wrapper);

        expect(warnings).toEqual([]);
        expect(harness.issues.filter((issue) => "ok" in issue)).toEqual([]);
    });

    it("每个网格各报各的：两个都配错的网格各警告一次", async () => {
        const first = twoColumns();
        const second = twoColumns();
        mountBare({node: first.root(), layout: first.layout(box), onGestureCommit: ACCEPT, contextKey: "first"});
        mountBare({node: second.root(), layout: second.layout(box), onGestureCommit: ACCEPT, contextKey: "second"});
        await nextTick();
        expect(warnings).toHaveLength(2);
        expect(warnings.some((message) => message.includes('"first"'))).toBe(true);
        expect(warnings.some((message) => message.includes('"second"'))).toBe(true);
    });
});
