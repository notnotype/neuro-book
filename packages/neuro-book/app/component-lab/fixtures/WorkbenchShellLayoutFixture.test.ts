// @vitest-environment jsdom
import {mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {nextTick} from "vue";
import WorkbenchShellLayoutFixture from "./WorkbenchShellLayoutFixture.vue";
import {LAB_DATA_SINK, LAB_EVENT_SINK, type LabDataSink, type LabEventSink} from "../lab-event-sink";

/**
 * 骨架 fixture 的组件级验收：它自己**不动几何**（那是 `layout.test.ts` 与真实浏览器的事），
 * 这里只钉三件在 Lab 里必须成立的事：
 * 1. 换场景是重建初值，不是叠加上一次的状态；
 * 2. 面板位置 / 对齐 / 隐藏真的换了壳根的树，而且只改这份内存状态（不写 localStorage）；
 * 3. View 标题动作经真实命令执行到**活动实例**上，实例自己的状态与探针计数都能作证。
 */

/**
 * `@dnd-kit/dom` 在**模块求值期**就取 `ResizeObserver`，而 `vi.stubGlobal` 在 `beforeEach` 里太晚了，
 * 因此这里用 `vi.hoisted` 在 import 之前把它补上（jsdom 没有这个 API）。
 */
vi.hoisted(() => {
    class ResizeObserverHoistedStub {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    }
    globalThis.ResizeObserver ??= ResizeObserverHoistedStub as unknown as typeof ResizeObserver;
});

let viewportWidth = 1440;
let viewportHeight = 900;
const wrappers: VueWrapper[] = [];

beforeEach(() => {
    viewportWidth = 1440;
    viewportHeight = 900;
    localStorage.clear();
    vi.stubGlobal("ResizeObserver", class {
        observe(): void {}
        disconnect(): void {}
        unobserve(): void {}
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => viewportWidth);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => viewportHeight);
});

afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
});

async function flush(): Promise<void> {
    // 壳内是「渲染 → nextTick → 再 nextTick（搬 DOM 后恢复焦点）」的链，多推几拍就够了；
    // 不用真实延时：那是把竞态藏进时间里的做法。
    for (let tick = 0; tick < 6; tick += 1) {
        await nextTick();
    }
}

type Harness = {
    wrapper: VueWrapper;
    events: Array<{name: string; payload?: unknown}>;
    data: unknown[];
};

function mountFixture(scene: string): Harness {
    const events: Array<{name: string; payload?: unknown}> = [];
    const data: unknown[] = [];
    const eventSink: LabEventSink = (name, payload) => {
        events.push({name, payload});
    };
    const dataSink: LabDataSink = (value) => {
        data.push(value);
    };
    const wrapper = mount(WorkbenchShellLayoutFixture, {
        props: {scene},
        attachTo: document.body,
        global: {
            provide: {
                [LAB_EVENT_SINK as symbol]: eventSink,
                [LAB_DATA_SINK as symbol]: dataSink,
            },
        },
    });
    wrappers.push(wrapper);
    return {wrapper, events, data};
}

function countOf(harness: Harness, prefix: string): number {
    return harness.events.filter((entry) => entry.name === prefix).length;
}

/**
 * 某个分支的**直属**叶（按 `closest(splitter)` 归属，不把更深分支里的叶也数进来）：
 * 位置 / 对齐是否真的换了树，看这个就够。
 *
 * 分支在 DOM 上的锚点是 `[data-splitter="<branchId>"]`（每一个分支一个 Splitter）；
 * 叶外面还有一层面板包装盒，所以「直属」按最近的祖先 Splitter 判断，而不是父元素。
 */
function leavesIn(branchId: string): string[] {
    const branch = document.querySelector(`[data-splitter="${branchId}"]`);
    if (branch === null) {
        return [];
    }
    return [...branch.querySelectorAll("[data-leaf]")]
        .filter((leaf) => leaf.closest("[data-splitter]") === branch)
        .map((leaf) => leaf.getAttribute("data-leaf") ?? "");
}

function textOf(selector: string): string {
    return document.querySelector(selector)?.textContent?.trim() ?? "";
}

function click(selector: string): void {
    const element = document.querySelector<HTMLElement>(selector);
    if (element === null) {
        throw new Error(`找不到要点击的节点：${selector}`);
    }
    element.click();
}

function lastData(harness: Harness): Record<string, unknown> {
    return (harness.data.at(-1) ?? {}) as Record<string, unknown>;
}

describe("WorkbenchShellLayoutFixture", () => {
    it("默认场景把七个 Part、七个空白 View（4 个可见）与两个演示动作渲染出来", async () => {
        const harness = mountFixture("default");
        await flush();

        expect(document.querySelector("[data-workbench-skeleton-fixture]")).not.toBeNull();
        expect(document.querySelector("[data-workbench-shell]")).not.toBeNull();

        // 默认场景藏起右栏（Lab 画布放不下两侧栏 + 可用编辑区），其余六个叶都在；右栏由活动栏项显示。
        for (const part of ["titlebar", "activity", "left", "editor", "panel", "statusbar"]) {
            expect(document.querySelector(`[data-leaf="${part}"]`), `缺少叶：${part}`).not.toBeNull();
        }
        expect(document.querySelector('[data-leaf="right"]')).toBeNull();

        // 七个空白 View 都有实例；未活动的容器（第二个主侧栏容器）停在实例层 parking，活动的容器所在 Part 被隐藏也仍活着。
        expect(document.querySelectorAll("[data-lab-skeleton-view]").length).toBe(7);
        expect(document.querySelector("[data-container-parking] [data-view-id=\"lab.extra-b\"]")).not.toBeNull();
        expect(document.querySelectorAll('[data-leaf="left"] [data-view-id]').length).toBe(2);
        expect(document.querySelectorAll('[data-leaf="panel"] [data-view-id]').length).toBe(2);
        expect(textOf('[data-lab-demo="counter"]')).toContain("0");
        expect(document.querySelector('[data-view-id="lab.panel-a"] [data-title-actions="view"] [data-title-action="increment"]')).not.toBeNull();
        expect(document.querySelector('[data-workbench-part="panel"] [data-title-actions="panel"] [data-title-action="more"]')).not.toBeNull();
        expect(document.querySelector('[data-shell-focus-target="panel-toggle"]')).not.toBeNull();
        expect(document.querySelector('[data-shell-focus-target="panel-title"]')).not.toBeNull();
        expect(leavesIn("panel-stack")).toEqual(["editor", "panel"]);

        // 上半只有容器：主侧栏的两个容器都在；选中第二个后主侧栏换成它的视图，而不是被隐藏。
        expect([...document.querySelectorAll("[data-activity-group=primary] [data-activity-id]")].map((item) => item.getAttribute("data-activity-id")))
            .toEqual(["lab.container.left", "lab.container.left-b"]);
        click('[data-activity-id="lab.container.left-b"]');
        await flush();
        expect(document.querySelector('[data-activity-group=primary] [data-activity-id="lab.container.left-b"]')?.getAttribute("aria-pressed")).toBe("true");
        expect(document.querySelector('[data-leaf="left"] [data-view-id="lab.extra-b"]')).not.toBeNull();
        // 显隐演示退休到底部条目：右栏仍能从这里显示出来。
        click('[data-activity-id="toggle-right"]');
        await flush();
        expect(document.querySelector('[data-leaf="right"]'), "活动栏「辅助侧边栏」应把右栏显示出来").not.toBeNull();
        click('[data-activity-id="toggle-right"]');
        await flush();
        expect(document.querySelector('[data-leaf="right"]')).toBeNull();
    });

    it("换场景重建初值：动作状态、面板结构与事件日志都回到该场景的初值", async () => {
        const harness = mountFixture("default");
        await flush();
        expect(textOf('[data-lab-demo="counter"]')).toContain("0");

        click('[data-title-actions="view"] [data-title-action="increment"]');
        await flush();
        expect(textOf('[data-lab-demo="counter"]')).toContain("1");
        expect(countOf(harness, "shell-reset")).toBeGreaterThanOrEqual(0);

        // 切到隐藏场景：初值是 hidden，且上一个场景的计数不该带过来。
        await harness.wrapper.setProps({scene: "panel-hidden"});
        await flush();
        expect(document.querySelector('[data-leaf="panel"]')).toBeNull();
        expect(lastData(harness).panel).toMatchObject({hidden: true});
        expect(harness.events.some((entry) => entry.name === "shell-reset" && (entry.payload as {scene?: string}).scene === "panel-hidden")).toBe(true);

        // 切回默认：计数从 0 重来（初值重建，不是恢复上一次的运行时值）。
        await harness.wrapper.setProps({scene: "default"});
        await flush();
        expect(document.querySelector('[data-leaf="panel"]')).not.toBeNull();
        expect(textOf('[data-lab-demo="counter"]')).toContain("0");
        expect(lastData(harness).panel).toMatchObject({hidden: false, collapsed: false});
    });

    it("面板位置、对齐与隐藏在内存里生效，并如实换掉壳根的树", async () => {
        const harness = mountFixture("default");
        await flush();
        expect(document.querySelector('[data-splitter="content-row"]')).toBeNull();

        // 位置：左侧 → Panel 与编辑区在同一个水平分支里，panel 在前。
        click('[data-lab-control="position-left"]');
        await flush();
        expect(leavesIn("panel-stack")).toEqual(["panel", "editor"]);
        expect(lastData(harness).panel).toMatchObject({position: "left"});
        expect(harness.events.some((entry) => entry.name === "panel-state-change")).toBe(true);

        // 对齐：两端对齐（先回底部）→ 出现 content-row，Panel 跨过左右侧栏但仍在活动栏右侧。
        click('[data-lab-control="position-bottom"]');
        await flush();
        click('[data-activity-id="toggle-right"]');
        await flush();
        click('[data-lab-control="alignment-justify"]');
        await flush();
        expect(document.querySelector('[data-splitter="content-row"]')).not.toBeNull();
        expect(leavesIn("content-row")).toEqual(["left", "editor", "right"]);
        expect(leavesIn("panel-stack")).toEqual(["panel"]);
        expect(lastData(harness).panel).toMatchObject({position: "bottom", alignment: "justify"});

        // 居中 + 最大化：占编辑区列（content-row 消失，Panel 与编辑区同列）。
        click('[data-lab-control="alignment-center"]');
        await flush();
        click('[data-lab-control="maximize-toggle"]');
        await flush();
        expect(lastData(harness).panel).toMatchObject({maximized: true});
        expect((lastData(harness).effectivePanel as {maximized: boolean}).maximized).toBe(true);

        // 换到「不支持最大化的组合」（底部 + 左对齐）：壳把无效的瞬时最大化清掉，宿主跟着清自己的 ref。
        click('[data-lab-control="alignment-left"]');
        await flush();
        expect(lastData(harness).panel).toMatchObject({position: "bottom", alignment: "left", maximized: false});
        expect((lastData(harness).effectivePanel as {maximized: boolean}).maximized).toBe(false);

        // 换位置本身只换树：左侧的 Panel 与编辑区在同一个水平分支里，panel 在前。
        click('[data-lab-control="position-left"]');
        await flush();
        expect(lastData(harness).panel).toMatchObject({position: "left"});
        expect(leavesIn("panel-stack")).toEqual(["panel", "editor"]);

        // 隐藏：叶零占用；再显示回来。
        click('[data-lab-control="hidden-toggle"]');
        await flush();
        expect(document.querySelector('[data-leaf="panel"]')).toBeNull();
        expect(lastData(harness).panel).toMatchObject({hidden: true});
        click('[data-lab-control="hidden-toggle"]');
        await flush();
        expect(document.querySelector('[data-leaf="panel"]')).not.toBeNull();

        // 全程没有写任何浏览器存储：这份状态只活在 fixture 的内存里。
        expect(localStorage.length).toBe(0);
    });

    it("紧凑呈现由容器宽驱动：390 宽画布进入 compact，活动栏仍是通高列", async () => {
        viewportWidth = 390;
        viewportHeight = 844;
        const harness = mountFixture("narrow");
        await flush();

        expect(document.querySelector("[data-workbench-shell]")?.getAttribute("data-shell-layout")).toBe("compact");
        expect(document.querySelector('[data-leaf="activity"]')).not.toBeNull();
        expect(lastData(harness).mode).toBe("compact");
    });

    it("View 动作按 Section 归属：panel-a 的计数与 panel-b 的标记互不影响", async () => {
        const harness = mountFixture("default");
        await flush();

        expect(textOf('[data-lab-demo="counter"]')).toContain("0");
        click('[data-view-id="lab.panel-a"] [data-title-actions="view"] [data-title-action="increment"]');
        await flush();
        click('[data-view-id="lab.panel-a"] [data-title-actions="view"] [data-title-action="increment"]');
        await flush();
        expect(textOf('[data-lab-demo="counter"]')).toContain("2");
        expect(harness.events.some((entry) => entry.name === "view-action-result"
            && (entry.payload as {command?: string}).command === "nbook.view.lab-increment")).toBe(true);
        expect(localStorage.length).toBe(0);

        // 另一个 Section 的动作只作用于它自己的实例：panel-b 的标记改了，panel-a 的计数不受影响。
        expect(textOf('[data-lab-demo="marker"]')).toContain("未标记");
        click('[data-view-id="lab.panel-b"] [data-title-actions="view"] [data-title-action="toggle"]');
        await flush();
        expect(textOf('[data-lab-demo="marker"]')).toContain("已标记");
        expect(textOf('[data-lab-demo="counter"]')).toContain("2");
        // panel-a 的按钮没有被 panel-b 的动作替换掉（同屏多 View，各有各的动作组）。
        expect(document.querySelector('[data-view-id="lab.panel-a"] [data-title-actions="view"] [data-title-action="increment"]')).not.toBeNull();
    });

    it("lifetime 场景：换面板位置搬 DOM 不重挂实例（探针计数不变）", async () => {
        const harness = mountFixture("lifetime");
        await flush();

        const probe = document.querySelector('[data-lab-probe="mounts"]');
        expect(probe, "lifetime 场景应打开探针").not.toBeNull();
        expect(probe?.textContent).toContain("挂载 1");
        const input = document.querySelector<HTMLInputElement>('[data-lab-probe="input"]');
        expect(input).not.toBeNull();
        if (input !== null) {
            input.value = "保留这段输入";
        }

        click('[data-lab-control="position-left"]');
        await flush();

        const after = document.querySelector('[data-lab-probe="mounts"]');
        expect(after?.textContent).toBe(probe?.textContent);
        expect(document.querySelector<HTMLInputElement>('[data-lab-probe="input"]')?.value).toBe("保留这段输入");
        expect(harness.events.some((entry) => entry.name === "shell-reset")).toBe(true);
    });

    it("when 不满足的视图不出现，容器空态把求值原因写出来", async () => {
        mountFixture("view-hidden");
        await flush();

        // `lab.gated` 是第二个面板容器唯一的视图；它不可见时容器是空的，空态直接给原因（不静默留白）。
        expect(document.querySelector('[data-lab-skeleton-view="lab.gated"]')).toBeNull();
        expect(textOf("[data-container-empty]")).toContain("只在用户资产工作区可见");
    });

    it("未知 factoryKey 的失败写在视图位置上，不留空白", async () => {
        mountFixture("unknown-factory");
        await flush();

        expect(document.querySelector('[data-lab-skeleton-view="lab.panel-b"]')).toBeNull();
        expect(textOf('[data-panel-id="view:lab.panel-b"]')).toContain("Lab 骨架没有登记这个 factoryKey");
    });
});
