/**
 * 面板头的标题区（docs/specs/workbench/views.md 输出 19，ui/workbench-layout.md 输出 20）：活动视图接管时整行三列，几个位置交给视图，
 * 视图用 `Teleport` 把内容送进来；标题按钮仍是工作台的拖动源；内容 region 的名称来自隐藏的声明标题。
 */

import {mount} from "@vue/test-utils";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, ref, shallowRef, Teleport} from "vue";
import type {PropType} from "vue";

import type {PanelHeadSlots} from "../views/view-head";
import {panelTabDomId, panelTabpanelDomId, panelTitleDomId} from "../state/layout-present";
import WorkbenchPanelHead from "./WorkbenchPanelHead.vue";
import type {PanelViewHead} from "./WorkbenchPanelHead.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

/** 像视图那样：拿到位置时把三段送进去，没有位置时画在自己这里。 */
const ProbeView = defineComponent({
    props: {slots: {type: Object as PropType<PanelHeadSlots | null>, default: null}},
    setup: (props) => () => h("div", {"data-probe-view": ""}, [
        h(Teleport, {to: props.slots?.start ?? null, disabled: props.slots === null}, [h("button", {type: "button", "data-probe-new": ""}, "新建")]),
        h(Teleport, {to: props.slots?.title ?? null, disabled: props.slots === null}, [h("span", {"data-probe-title": ""}, "第三章节奏调整")]),
        h(Teleport, {to: props.slots?.end ?? null, disabled: props.slots === null}, [h("button", {type: "button", "data-probe-more": ""}, "更多")]),
    ]),
});

const TAB = {id: "view:nbook.agent.conversation", label: "对话", icon: "i-lucide-message-square"};

function mountHead(initial: PanelViewHead | null) {
    const viewHead = ref<PanelViewHead | null>(initial);
    const slots = shallowRef<PanelHeadSlots | null>(null);
    const given: Array<PanelHeadSlots | null> = [];
    const activated: string[] = [];
    const Host = defineComponent({
        setup: () => () => [
            h(WorkbenchPanelHead, {
                panelId: "right",
                label: "右栏",
                tabs: [TAB],
                active: TAB.id,
                moreLabel: "更多",
                idPrefix: "probe",
                dragHint: "按空格拿起",
                titleOnly: true,
                frameActions: [{id: "maximize", label: "最大化", icon: "i-lucide-maximize-2", disabled: false}],
                viewHead: viewHead.value,
                onActivate: (id: string) => activated.push(id),
                onHeadSlots: (next: PanelHeadSlots | null) => {
                    given.push(next);
                    slots.value = next;
                },
            }),
            h(ProbeView, {slots: slots.value}),
        ],
    });
    const wrapper = mount(Host, {attachTo: document.body});
    mounted.push(wrapper);
    return {wrapper, viewHead, given, activated};
}

const handle = () => document.querySelector<HTMLButtonElement>("[data-panel-tab]")!;
/** 按钮里此刻写的字：视图送进来的，或声明标题。 */
const shown = (): string | undefined => document.querySelector("[data-panel-tab]")?.textContent?.trim();

describe("WorkbenchPanelHead 的标题区", () => {
    it("视图接管时：内容送进三列，标题按钮仍是拖动源、带工作台的 id 与拖动描述，名称是视图送进来的文字", async () => {
        const {given} = mountHead({key: "nbook.agent.conversation:1", popup: {expanded: false}});
        await waitUntil("交出位置、内容送进标题按钮", () => given.length === 1 && shown() === "第三章节奏调整");
        expect(given[0]?.handle).toBe(handle());
        expect(handle().id).toBe(panelTabDomId("probe", TAB.id));
        expect(handle().getAttribute("data-panel-tab")).toBe(TAB.id);
        expect(handle().getAttribute("aria-description")).toBe("按空格拿起");
        expect(handle().textContent?.trim()).toBe("第三章节奏调整");
        expect(document.querySelector("[data-panel-head-start] [data-probe-new]")).not.toBeNull();
        expect(document.querySelector("[data-panel-head-end] [data-probe-more]")).not.toBeNull();
        // 可交互的东西在不起拖的位置里，不在按钮里。
        expect(document.querySelector("[data-probe-new]")!.closest("[data-no-drag]")).not.toBeNull();
        expect(handle().querySelector("button")).toBeNull();
        // 框架按钮在右列，视图的内容在它们前面。
        const end = document.querySelector("[data-panel-head-end]")!;
        const frame = document.querySelector("[data-panel-action='maximize']")!;
        expect(end.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("内容区的名称来自隐藏的声明标题，与按钮写什么无关", async () => {
        mountHead({key: "nbook.agent.conversation:1", popup: null});
        await waitUntil("视图的字送进按钮", () => shown() === "第三章节奏调整");
        const title = document.getElementById(panelTitleDomId("probe", TAB.id))!;
        expect(title.hidden).toBe(true);
        expect(title.textContent).toBe("对话");
    });

    it("视图的标题按钮带稳定名 workbench.view 与视图 id，接管标题区时也一样（agent/page-agent.md 输出 6）", async () => {
        const {viewHead} = mountHead(null);
        await waitUntil("画出标题按钮", () => handle() !== null);
        expect([handle().dataset.nbTarget, handle().dataset.nbKey]).toEqual(["workbench.view", "nbook.agent.conversation"]);
        viewHead.value = {key: "nbook.agent.conversation:1", popup: null};
        await waitUntil("视图接管标题区", () => document.querySelector("[data-panel-head-start]") !== null);
        expect([handle().dataset.nbTarget, handle().dataset.nbKey]).toEqual(["workbench.view", "nbook.agent.conversation"]);
    });

    it("弹出状态写到按钮上；点按钮发 activate", async () => {
        const {viewHead, activated} = mountHead({key: "nbook.agent.conversation:1", popup: {expanded: false}});
        await waitUntil("写上弹出状态", () => handle().getAttribute("aria-haspopup") === "dialog");
        expect(handle().getAttribute("aria-expanded")).toBe("false");
        viewHead.value = {key: "nbook.agent.conversation:1", popup: {expanded: true}};
        await waitUntil("展开", () => handle().getAttribute("aria-expanded") === "true");
        viewHead.value = {key: "nbook.agent.conversation:1", popup: null};
        await waitUntil("不弹出东西", () => !handle().hasAttribute("aria-haspopup"));
        expect(handle().hasAttribute("aria-expanded")).toBe(false);
        handle().click();
        expect(activated).toEqual([TAB.id]);
    });

    it("实例换代时交一组新的位置；不再接管时交 null，按钮写回声明标题", async () => {
        const {viewHead, given} = mountHead({key: "nbook.agent.conversation:1", popup: null});
        await waitUntil("第一组位置", () => given.length === 1);
        viewHead.value = {key: "nbook.agent.conversation:2", popup: null};
        await waitUntil("换代后的一组位置", () => given.length === 2 && shown() === "第三章节奏调整");
        expect(given[1]).not.toBeNull();
        expect(given[1]!.title).not.toBe(given[0]!.title);
        expect(handle().textContent?.trim()).toBe("第三章节奏调整");

        viewHead.value = null;
        await waitUntil("交回 null、写回声明标题", () => given.at(-1) === null && shown() === "对话");
        // 视图的内容回到视图自己那里。
        expect(document.querySelector("[data-probe-view] [data-probe-title]")).not.toBeNull();
    });

    it("没有接管时照旧：不交位置，按钮写声明标题", async () => {
        const {given} = mountHead(null);
        await waitUntil("画出面板头", () => shown() === "对话");
        expect(given).toEqual([]);
        expect(document.querySelector("[data-panel-head-start]")).toBeNull();
    });
});

describe("WorkbenchPanelHead 的展开标记（ui/workbench-layout.md 输出 20）", () => {
    function mountFold(fold: {collapsed: boolean} | null, viewHead: PanelViewHead | null = null) {
        const events: string[] = [];
        const wrapper = mount(WorkbenchPanelHead, {
            attachTo: document.body,
            props: {
                panelId: "s1", label: "侧栏", tabs: [TAB], active: TAB.id, moreLabel: "更多", idPrefix: "probe", dragHint: "按 Enter 展开或收起", titleOnly: true,
                frameActions: [{id: "maximize", label: "最大化", icon: "i-lucide-maximize-2", disabled: false}],
                viewHead, fold, foldLabel: fold?.collapsed === true ? "展开 对话" : "收起 对话",
                onActivate: (id: string) => events.push(`activate:${id}`),
                onToggleFold: () => events.push("toggle-fold"),
            },
        });
        mounted.push(wrapper);
        return {wrapper, events};
    }
    const head = () => document.querySelector<HTMLElement>("[data-panel-head]")!;

    it("能收起时：标记在标题按钮里、标题前；按钮带 aria-expanded 与 aria-controls；点它先聚焦再发 activate，切换由宿主做", async () => {
        const {events} = mountFold({collapsed: false});
        const button = handle();
        expect(button.firstElementChild?.hasAttribute("data-panel-fold")).toBe(true);
        expect([button.getAttribute("aria-expanded"), button.getAttribute("aria-controls")]).toEqual(["true", panelTabpanelDomId("probe", TAB.id)]);
        button.click();
        expect(document.activeElement).toBe(button);
        expect(events).toEqual([`activate:${TAB.id}`]);
        expect(head().hasAttribute("data-collapsed")).toBe(false);
    });

    it("收着时：aria-expanded 为假，头写 data-collapsed，悬停范围就是这一行", () => {
        mountFold({collapsed: true});
        expect(handle().getAttribute("aria-expanded")).toBe("false");
        expect(head().hasAttribute("data-collapsed")).toBe(true);
        expect(head().hasAttribute("data-hover-actions-scope")).toBe(true);
    });

    it("标题写在入口上（底部面板并成一行，输出 47）：头里没有看得见的标题、没有标题按钮，内容区名称指向的隐藏标题还在，框架按钮照旧", () => {
        const wrapper = mount(WorkbenchPanelHead, {
            attachTo: document.body,
            props: {panelId: "s1", label: "通知", tabs: [TAB], active: TAB.id, moreLabel: "更多", idPrefix: "probe", titleOnly: true, titleInEntry: true, frameActions: [{id: "maximize", label: "最大化", icon: "i-lucide-maximize-2", disabled: false}]},
        });
        mounted.push(wrapper);
        expect(document.querySelector("[data-panel-tab]")).toBeNull();
        expect(document.querySelector(".workbench-panel-head__title")).toBeNull();
        const hidden = document.getElementById(panelTitleDomId("probe", TAB.id));
        expect([hidden?.hidden, hidden?.textContent]).toEqual([true, TAB.label]);
        expect(document.querySelector("[data-panel-action='maximize']")).not.toBeNull();
    });

    it("不能收起时没有标记、没有 aria-expanded；框架按钮在悬停才出的容器里（frame）", () => {
        mountFold(null);
        expect(document.querySelector("[data-panel-fold]")).toBeNull();
        expect(handle().hasAttribute("aria-expanded")).toBe(false);
        expect(document.querySelector("[data-panel-action='maximize']")?.closest("[data-hover-actions]")?.getAttribute("data-hover-actions")).toBe("frame");
    });

    it("视图接管标题区时：标记是左列里单独的按钮，有名称与 aria-expanded，点它发 toggle-fold；标题按钮照旧是视图的弹层开关", async () => {
        const {events} = mountFold({collapsed: false}, {key: "nbook.agent.conversation:1", popup: {expanded: false}});
        await waitUntil("画出接管的头", () => document.querySelector("[data-panel-head-start]") !== null);
        const fold = document.querySelector<HTMLButtonElement>("button[data-panel-fold]")!;
        expect([fold.getAttribute("aria-label"), fold.getAttribute("aria-expanded")]).toEqual(["收起 对话", "true"]);
        expect(fold.closest("[data-panel-tab]")).toBeNull();
        expect(handle().getAttribute("aria-haspopup")).toBe("dialog");
        fold.click();
        expect(events).toEqual(["toggle-fold"]);
    });
});

describe("视图自绘头（views.md 输出 19 的“自绘头”）", () => {
    function mountOwn(actionsShown: boolean) {
        const events: string[] = [];
        const given: Array<PanelHeadSlots | null> = [];
        const wrapper = mount(WorkbenchPanelHead, {
            attachTo: document.body,
            props: {
                panelId: "p-float",
                label: "浮动",
                tabs: [TAB],
                active: TAB.id,
                moreLabel: "更多",
                idPrefix: "probe",
                dragHint: "按空格拿起",
                titleOnly: true,
                frameActions: [{id: "nbook.view.dock", label: "回到停靠", icon: "i-lucide-panel-right-close", disabled: false}],
                viewHead: {key: "nbook.agent.conversation:1", popup: null},
                ownHead: {band: 40},
                actionsShown,
                onActivate: (id: string) => events.push(`activate:${id}`),
                onHeadSlots: (slots: PanelHeadSlots | null) => given.push(slots),
            },
        });
        mounted.push(wrapper);
        return {events, given};
    }

    it("画成盖在内容顶上的一条：没有标签带、不交标题区的位置；标题按钮仍是拖动源、名称是视图标题，内容区名称指向的隐藏标题还在；框架按钮在悬停才出的容器里", async () => {
        const {events, given} = mountOwn(false);
        const head = document.querySelector<HTMLElement>("[data-panel-head='p-float']")!;
        expect(head.hasAttribute("data-own-head")).toBe(true);
        expect(head.style.getPropertyValue("--own-head-band")).toBe("40px");
        expect(head.querySelector("[data-panel-band]")).toBeNull();
        expect(head.querySelector("[data-panel-head-start]")).toBeNull();
        expect(given).toEqual([]);
        const title = head.querySelector<HTMLButtonElement>(`[data-panel-tab='${TAB.id}']`)!;
        expect([title.id, title.textContent?.trim(), title.getAttribute("aria-description")]).toEqual([panelTabDomId("probe", TAB.id), "对话", "按空格拿起"]);
        expect(document.getElementById(panelTitleDomId("probe", TAB.id))?.textContent).toBe("对话");
        expect(head.querySelector("[data-panel-action='nbook.view.dock']")?.closest("[data-hover-actions]")?.getAttribute("data-hover-actions")).toBe("frame");
        expect(head.hasAttribute("data-hover-actions-active")).toBe(false);
        title.click();
        expect(events).toEqual([`activate:${TAB.id}`]);
        expect(document.activeElement).toBe(title);
    });

    it("宿主说指针或焦点在这块窗的内容上时，这一条自己就是悬停范围、标成显示", () => {
        mountOwn(true);
        const head = document.querySelector<HTMLElement>("[data-panel-head='p-float']")!;
        expect([head.hasAttribute("data-hover-actions-scope"), head.hasAttribute("data-hover-actions-active")]).toEqual([true, true]);
    });
});
