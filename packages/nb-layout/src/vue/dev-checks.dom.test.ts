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
 * 开发模式的配置检查（Spec `ui/nested-grid` 输出 151、158、159）：真实的 `NestedGrid` 与 `useGridHost`，手势照真实路径走。
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
        // 固定尺寸的节点夹在中间：两条边界都挨着它，都拖不动；只看一侧的判据会误报。
        const rigid = (id: string, width: number): Parameters<typeof createGrid<string>>[0] & object => ({kind: "leaf", id, ref: id, size: {width, height: 0}, minimumSize: {width, height: 0}, maximumSize: {width, height: Number.MAX_SAFE_INTEGER}});
        const middle = createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [
            {kind: "leaf", id: "a", ref: "a", size: {width: 400, height: 0}}, rigid("bar", 48), {kind: "leaf", id: "b", ref: "b", size: {width: 400, height: 0}},
        ]});
        mountBare({node: middle.root(), layout: middle.layout(box), onGestureCommit: ACCEPT});
        // 收成标题行的面板（主轴上刚性）夹在中间：同上。
        const titled = createGrid<string>({kind: "branch", id: "root", orientation: "vertical", children: [
            {kind: "leaf", id: "a", ref: "a", size: {width: 0, height: 300}},
            {kind: "leaf", id: "t", ref: "t", size: {width: 0, height: 200}, minimumSize: {width: 0, height: 100}, collapse: {collapsed: true, collapsedSize: 28, collapseThreshold: 24, expandThreshold: 24}},
            {kind: "leaf", id: "b", ref: "b", size: {width: 0, height: 300}},
        ]});
        mountBare({node: titled.root(), layout: titled.layout(box), onGestureCommit: ACCEPT});
        // 0 宽的缝挨着固定尺寸的节点（工作台的条）：那条边界本来就拖不动，不算。
        const barred = createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [
            {kind: "leaf", id: "bar", ref: "bar", size: {width: 48, height: 0}, minimumSize: {width: 48, height: 0}, maximumSize: {width: 48, height: Number.MAX_SAFE_INTEGER}},
            {kind: "leaf", id: "editor", ref: "editor", size: {width: 900, height: 0}},
        ]});
        mountBare({node: barred.root(), layout: barred.layout(box), onGestureCommit: ACCEPT});
        // 只有一片叶：没有分隔条，谈不上拖不动。
        const single = createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [{kind: "leaf", id: "only", ref: "only", size: {width: 1, height: 0}}]});
        mountBare({node: single.root(), layout: single.layout(box), onGestureCommit: ACCEPT});
        await nextTick();
        expect(warnings).toHaveLength(1);

        // 末尾是固定尺寸的节点、前两块都能调：那条边界 0 宽，要报。
        const tail = createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [
            {kind: "leaf", id: "a", ref: "a", size: {width: 400, height: 0}}, {kind: "leaf", id: "b", ref: "b", size: {width: 400, height: 0}}, rigid("bar", 48),
        ]});
        mountBare({node: tail.root(), layout: tail.layout(box), onGestureCommit: ACCEPT, contextKey: "tail"});
        await nextTick();
        expect(warnings.filter((message) => message.includes('"tail"'))).toHaveLength(1);
    });

    it("经 useGridHost 的真实路径：缺省 sashSize，量到尺寸、手势启用之后警告一次；换网格实例不再报", async () => {
        const harness = mountHost(twoColumns());
        await nextTick();
        await nextTick();
        expect(warnings.filter((message) => message.includes("sashSize defaults to 0"))).toHaveLength(1);
        harness.grid.value = twoColumns();
        await nextTick();
        expect(warnings.filter((message) => message.includes("sashSize defaults to 0"))).toHaveLength(1);
    });

    it("提交处理三种接错各是一条警告：拖两次只报一次，警告带 contextKey、只出自己那一种；提交照旧以 handler-missing 等交出", async () => {
        // 一个网格只配错一种，按 contextKey 认出这个网格的警告，断言它只有一条、是自己那一种。
        const onlyWarning = (key: string): string[] => warnings.filter((message) => message.includes(`"${key}"`));
        const scenario = async (key: string, onGestureCommit: CommitHandler | undefined): Promise<VueWrapper> => {
            const grid = twoColumns(1);
            const wrapper = mountBare({node: grid.root(), layout: grid.layout(box), contextKey: key, ...(onGestureCommit === undefined ? {} : {onGestureCommit})});
            await nextTick();
            await drag(wrapper);
            await drag(wrapper);
            return wrapper;
        };

        const bare = await scenario("bare", undefined);
        expect(onlyWarning("bare")).toHaveLength(1);
        expect(onlyWarning("bare")[0]).toContain("has no onGestureCommit");
        const issues = (bare.emitted("issues") ?? []).flatMap((args) => args[0] as GridHostIssue[]);
        expect(issues.map((issue) => issue.code)).toContain("handler-missing");

        // 类型不对的调用方（例如 JS 里写成了事件）：处理函数什么也不返回、返回 Promise、返回 true。
        for (const [key, label, result] of [["none", "undefined", undefined], ["async", "a Promise", Promise.resolve({ok: true})], ["flag", "boolean", true]] as const) {
            await scenario(key, (() => result) as unknown as CommitHandler);
            expect(onlyWarning(key)).toHaveLength(1);
            expect(onlyWarning(key)[0]).toContain(`got ${label} from onGestureCommit`);
        }

        // 整包绑定后又写 @gesture-commit：提交处理被合成数组，不是函数。
        await scenario("merged", [ACCEPT, ACCEPT] as unknown as CommitHandler);
        expect(onlyWarning("merged")).toHaveLength(1);
        expect(onlyWarning("merged")[0]).toContain("not a function (an array)");
    });

    it("没给 contextKey 的网格与宿主：警告里写明没有 contextKey", async () => {
        const grid = twoColumns();
        mountBare({node: grid.root(), layout: grid.layout(box), onGestureCommit: ACCEPT});
        const host = mountHost(twoColumns(1), {revision: 0});
        host.context.value = "";
        await nextTick();
        await drag(host.wrapper);
        expect(warnings.some((message) => message.includes("A NestedGrid without a contextKey"))).toBe(true);
        expect(warnings.some((message) => message.includes("the grid without a contextKey"))).toBe(true);
    });

    it("开关开与关时，失败与 issues 事件完全一样：警告不往 issues 里加东西", async () => {
        const run = async (enabled: boolean): Promise<unknown[]> => {
            setLayoutDevChecks(enabled);
            const grid = twoColumns(1);
            const bare = mountBare({node: grid.root(), layout: grid.layout(box)});
            const host = mountHost(twoColumns(1), {contextKey: "other"});
            await nextTick();
            await drag(bare);
            await drag(host.wrapper);
            const strip = (issue: GridHostIssue) => ({code: issue.code, ...("ok" in issue ? {ok: issue.ok} : {})});
            return [(bare.emitted("issues") ?? []).flatMap((args) => (args[0] as GridHostIssue[]).map(strip)), host.issues.map(strip)];
        };
        const off = await run(false);
        const on = await run(true);
        expect(on).toEqual(off);
        expect(JSON.stringify(off)).toContain("handler-missing");
        expect(JSON.stringify(off)).toContain("stale-context");
    });

    it("整包绑定后模板里另写了 context-key：按下时警告一次", async () => {
        const harness = mountHost(twoColumns(1), {contextKey: "other"});
        await nextTick();
        await drag(harness.wrapper);
        await drag(harness.wrapper);
        const mine = warnings.filter((message) => message.includes("[nb-layout/useGridHost]"));
        expect(mine).toHaveLength(1);
        expect(mine[0]).toContain('contextKey "other"');
        expect(mine[0]).toContain('the host\'s is "main"');
    });

    it("在手势开始时核对、不等提交：按下就松手（没有提交）也警告", async () => {
        const harness = mountHost(twoColumns(1), {contextKey: "other"});
        await nextTick();
        const sash = harness.wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        sash.dispatchEvent(pointerEvent("pointerdown", 500.5, 300));
        sash.dispatchEvent(pointerEvent("pointerup", 500.5, 300));
        await nextTick();
        expect(warnings.filter((message) => message.includes("[nb-layout/useGridHost]") && message.includes("contextKey"))).toHaveLength(1);
    });

    it("整包绑定后模板里另写了 revision：缺省的 0 与一个过期的版本都警告", async () => {
        const zero = mountHost(twoColumns(1), {revision: 0});
        await nextTick();
        await drag(zero.wrapper);
        await drag(zero.wrapper);
        expect(warnings.filter((message) => message.includes("revision 0"))).toHaveLength(1);
        expect(warnings.find((message) => message.includes("revision 0"))).toContain('grid "main"');

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

    it("缺省关：从来没调过开关时不警告", async () => {
        // 模拟一个从没调过开关的页面：清掉全局符号上的状态（各测试之间共用的那一份）。
        delete (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("nb-layout.devChecks")];
        const grid = twoColumns();
        mountBare({node: grid.root(), layout: grid.layout(box), onGestureCommit: ACCEPT});
        const host = mountHost(twoColumns(1), {contextKey: "other"});
        await nextTick();
        await drag(host.wrapper);
        expect(warnings).toEqual([]);
    });

    it("能拖的边界里有一条不是 0 宽：不警告（要全是 0 才报）", async () => {
        const grid = createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [
            {kind: "leaf", id: "a", ref: "a", size: {width: 300, height: 0}},
            {kind: "leaf", id: "b", ref: "b", size: {width: 300, height: 0}},
            {kind: "leaf", id: "c", ref: "c", size: {width: 300, height: 0}},
        ]}, {sashSize: (_branch, index) => (index === 0 ? 0 : 4)});
        mountBare({node: grid.root(), layout: grid.layout(box), onGestureCommit: ACCEPT});
        await nextTick();
        expect(warnings).toEqual([]);
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

/** 不经 `mountHost`、按给定的选项建宿主：用来测 `onIssues` 给没给。 */
function mountHostWith(options: {contextKey?: string; onIssues?: (issues: readonly GridHostIssue[]) => void}): VueWrapper {
    const grid = shallowRef(twoColumns(1));
    const Host = defineComponent({
        setup() {
            const host = useGridHost<string>({grid, ...options});
            return () => h(NestedGrid, host.bindings.value, {leaf: (scope: {node: {id: string}}) => h("div", scope.node.id)});
        },
    });
    const wrapper = mount(Host, {attachTo: document.body});
    wrappers.push(wrapper);
    return wrapper;
}

describe("开发模式：诊断没有出口（Spec 输出 158）", () => {
    const noOutlet = (): string[] => warnings.filter((message) => message.includes("has no onIssues"));

    it("useGridHost 没给 onIssues：建立时警告一次，带 contextKey；拖动、重渲染之后不再报；没给 contextKey 的写明没有", async () => {
        const wrapper = mountHostWith({contextKey: "silent"});
        await nextTick();
        await nextTick();
        expect(noOutlet()).toHaveLength(1);
        expect(noOutlet()[0]).toContain("[nb-layout/useGridHost]");
        expect(noOutlet()[0]).toContain('grid "silent"');
        await drag(wrapper);
        expect(noOutlet()).toHaveLength(1);

        mountHostWith({});
        expect(noOutlet()).toHaveLength(2);
        expect(noOutlet()[1]).toContain("the grid without a contextKey");
    });

    it("给了 onIssues 的不报，什么都不做的 onIssues 也不报；开关关着时没给也不报", async () => {
        mountHost(twoColumns(1));
        mountHostWith({contextKey: "ignored", onIssues: () => undefined});
        setLayoutDevChecks(false);
        mountHostWith({contextKey: "off"});
        await nextTick();
        expect(noOutlet()).toEqual([]);
    });
});

describe("开发模式：起拖时过渡还在走（Spec 输出 159）", () => {
    type Exposed = {settleMotion(): void; readonly moving: boolean};
    const duringMotion = (): string[] => warnings.filter((message) => message.includes("while a layout transition was still running"));
    const columns = (left: number): Grid<string> => createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [
        {kind: "leaf", id: "a", ref: "a", size: {width: left, height: 0}, sizing: "fixed"},
        {kind: "leaf", id: "b", ref: "b", size: {width: 999 - left, height: 0}},
    ]}, {sashSize: 1});

    /** 网格挂上、过渡时长设好，再发布一次同样的布局：第一次布局回调只记下尺寸、不过渡，之后改宽才会过渡。 */
    async function mountMoving(key: string, motion: string): Promise<{wrapper: VueWrapper; exposed: Exposed; relayout(left: number, extra?: Record<string, unknown>): Promise<void>}> {
        const start = columns(500);
        const wrapper = mount(NestedGrid, {props: {node: start.root(), layout: start.layout(box), contextKey: key, dragging: false}, attachTo: document.body, slots: {leaf: (scope: {node: {id: string}}) => h("div", scope.node.id)}});
        wrappers.push(wrapper);
        wrapper.element.style.setProperty("--nb-layout-motion-layout", motion);
        const relayout = async (left: number, extra: Record<string, unknown> = {}): Promise<void> => {
            const next = columns(left);
            await wrapper.setProps({node: next.root(), layout: next.layout(box), ...extra});
        };
        await relayout(500);
        return {wrapper, exposed: wrapper.vm as unknown as Exposed, relayout};
    }

    it("由程序改布局、过渡在走时 dragging 变真：警告一次，带 contextKey；落下再起、又一轮过渡里再起，都不再报", async () => {
        const {wrapper, exposed, relayout} = await mountMoving("moving", "10s");
        await relayout(300);
        expect(exposed.moving).toBe(true);
        await wrapper.setProps({dragging: true});
        expect(duringMotion()).toHaveLength(1);
        expect(duringMotion()[0]).toContain('NestedGrid "moving"');
        expect(duringMotion()[0]).toContain("settleMotion()");
        await wrapper.setProps({dragging: false});
        await relayout(400);
        expect(exposed.moving).toBe(true);
        await wrapper.setProps({dragging: true});
        expect(duringMotion()).toHaveLength(1);
    });

    it("起拖前调了 settleMotion() 不报；dragging 与改布局在同一次更新里给（过渡是这次才开始的）也不报", async () => {
        const settled = await mountMoving("settled", "10s");
        await settled.relayout(300);
        expect(settled.exposed.moving).toBe(true);
        settled.exposed.settleMotion();
        expect(settled.exposed.moving).toBe(false);
        await settled.wrapper.setProps({dragging: true});

        const together = await mountMoving("together", "10s");
        expect(together.exposed.moving).toBe(false);
        await together.relayout(300, {dragging: true});
        // 先证明这次更新确实开始了过渡：不然下面的“不报”是空过。
        expect(together.exposed.moving).toBe(true);
        expect(duringMotion()).toEqual([]);
    });

    it("减少动效（过渡时长 0）：改布局不开过渡，dragging 变真不报", async () => {
        const {wrapper, exposed, relayout} = await mountMoving("reduced", "0ms");
        await relayout(300);
        expect(exposed.moving).toBe(false);
        await wrapper.setProps({dragging: true});
        expect(duringMotion()).toEqual([]);
    });
});
