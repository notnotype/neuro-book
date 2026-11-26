/**
 * AgentMessages、AgentMessagesSegment 与 AgentMessagesList（同名 .md）：视图段送进侧轨的两个位置或画在右边缘、换位置不重挂；收着的各项与底段，
 * 展开的列表、聚焦搜索与 Esc。中段按高度截几项的规则在 `src/messages-segment-fit.test.ts`；真实的轨宽、过渡与 roving 在 e2e 与 Lab 里看。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, nextTick, onMounted, ref} from "vue";

import type {MessagesContactSection} from "../../types";
import AgentMessages from "./AgentMessages.vue";
import AgentMessagesList from "./AgentMessagesList.vue";
import type {MessagesSegmentPlacement} from "./placement";

afterEach(() => {
    document.body.innerHTML = "";
});

const NOW = Date.parse("2026-11-20T10:00:00Z");
const SECTIONS: MessagesContactSection[] = [{
    key: "nbook.bots",
    state: {kind: "ready"},
    contacts: [
        {key: "nbook.bots/lyra", name: "星璃", unread: 2, activity: "idle", last: {text: "这周的简报写好了。", at: NOW - 60_000}},
        {key: "nbook.bots/vega", name: "织女", unread: null, activity: "waiting", last: null},
        {key: "nbook.bots/nova", name: "新星", unread: 0, activity: "running", last: {text: "旧的话", at: NOW - 120_000}},
    ],
}];
const RECENT = [{id: "s1", title: "第三章节奏调整", icon: "i-lucide-feather"}, {id: "s2", title: "人物卡补全", icon: "i-lucide-feather"}];

let chatMounts = 0;
const Chat = defineComponent({setup: () => {
    onMounted(() => {
        chatMounts += 1;
    });
    return () => h("div", {"data-probe-chat": ""}, [h("textarea", {"data-probe-input": ""})]);
}});

/** 侧轨的替身：工作台给视图的两个位置。 */
function railTargets(): {main: HTMLElement; foot: HTMLElement} {
    const main = document.createElement("div");
    main.setAttribute("data-probe-main", "");
    const foot = document.createElement("div");
    foot.setAttribute("data-probe-foot", "");
    document.body.append(main, foot);
    return {main, foot};
}

/** 像宿主那样持有几个受控值。 */
function mountFrame(initial: {placement?: MessagesSegmentPlacement; expanded?: boolean; selected?: {kind: "contact"; key: string} | {kind: "session"; id: string}; weak?: boolean} = {}) {
    chatMounts = 0;
    const placement = ref<MessagesSegmentPlacement>(initial.placement ?? {kind: "rail", ...railTargets()});
    const expanded = ref(initial.expanded ?? false);
    const tab = ref<"bot" | "sessions">("bot");
    const botQuery = ref("");
    const events: unknown[][] = [];
    const record = (name: string) => (...args: unknown[]) => events.push([name, ...args]);
    const frameRef = ref<{focusSearch(page: "bot" | "sessions"): void} | null>(null);
    const Host = defineComponent({setup: () => () => h(AgentMessages, {
        ref: frameRef,
        placement: placement.value,
        expanded: expanded.value,
        tab: tab.value,
        botQuery: botQuery.value,
        sections: SECTIONS,
        selected: initial.selected ?? {kind: "contact", key: "nbook.bots/lyra"},
        recentSessions: RECENT,
        weak: initial.weak ?? false,
        now: NOW,
        locale: "zh-CN",
        "onUpdate:tab": (next: "bot" | "sessions") => {
            tab.value = next;
            events.push(["update:tab", next]);
        },
        "onUpdate:botQuery": (next: string) => {
            botQuery.value = next;
        },
        onOpenContact: record("open-contact"),
        onOpenSession: record("open-session"),
        onNewSession: record("new-session"),
        onShowList: record("show-list"),
        onEscapeSearch: record("escape-search"),
    }, {default: () => h(Chat), sessions: () => h("div", {"data-probe-sessions": ""}, [h("input", {"data-probe-session-search": ""})])})});
    const wrapper = mount(Host, {attachTo: document.body});
    const frame = () => frameRef.value!;
    return {wrapper, placement, expanded, tab, botQuery, events, frame};
}

const $ = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
const $$ = (selector: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(selector)];
const shown = (element: HTMLElement): boolean => element.style.display !== "none";

describe("AgentMessages 与 AgentMessagesSegment", () => {
    it("送进侧轨：中段与底段各在侧轨给的元素里，各项带 data-rail-item；视图里只有聊天区", () => {
        const {wrapper, placement} = mountFrame();
        const {main, foot} = placement.value as {main: HTMLElement; foot: HTMLElement};
        const segment = main.querySelector<HTMLElement>("[data-messages-segment]")!;
        expect(segment.getAttribute("data-messages-segment-state")).toBe("collapsed");
        expect([...main.querySelectorAll("[data-strip-contact]")].map((item) => item.getAttribute("data-strip-contact"))).toEqual(["nbook.bots/lyra", "nbook.bots/vega", "nbook.bots/nova"]);
        expect(main.querySelector("[data-messages-new-session]")).not.toBeNull();
        expect([...main.querySelectorAll("[data-strip-session]")].map((item) => item.textContent?.trim())).toEqual(["第", "人"]);
        expect([...foot.querySelectorAll("[data-messages-open]")].map((item) => item.getAttribute("data-messages-open"))).toEqual(["bot", "sessions"]);
        for (const item of [...main.querySelectorAll("button"), ...foot.querySelectorAll("button")]) expect(item.hasAttribute("data-rail-item")).toBe(true);
        expect(wrapper.find("[data-messages-chat] [data-probe-chat]").exists()).toBe(true);
        expect(wrapper.find("[data-messages-segment]").exists()).toBe(false);
        wrapper.unmount();
    });

    it("收着：当前 bot 带 aria-current 与竖条；未读写数字、等你处理是另一种形状的点；名称带未读与等你处理；汇总徽标有等你处理时另有标记", () => {
        const {wrapper} = mountFrame();
        const [lyra, vega, nova] = $$("[data-strip-contact]");
        expect([lyra!.getAttribute("aria-current"), vega!.getAttribute("aria-current")]).toEqual(["true", null]);
        expect(lyra!.closest(".acv-segment__row")!.querySelector(".acv-segment__bar")).not.toBeNull();
        expect(lyra!.querySelector(".acv-segment__count")?.textContent).toBe("2");
        expect([vega!.hasAttribute("data-strip-waiting"), vega!.querySelector(".acv-segment__dot") !== null, vega!.querySelector(".acv-segment__count")]).toEqual([true, true, null]);
        expect(nova!.querySelector(".acv-segment__count, .acv-segment__dot")).toBeNull();
        expect([lyra!.getAttribute("aria-label"), vega!.getAttribute("aria-label"), nova!.getAttribute("aria-label")]).toEqual(["星璃，2 条未读", "织女，等你处理", "新星"]);
        const summary = $("[data-messages-open='bot'] [data-messages-summary]")!;
        expect([summary.textContent, summary.hasAttribute("data-messages-summary-waiting")]).toEqual(["2", true]);
        wrapper.unmount();
    });

    it("当前会话描边（aria-current）；区域隐藏或拖到零时退成弱的（data-rail-weak）", () => {
        const {wrapper} = mountFrame({selected: {kind: "session", id: "s2"}, weak: true});
        expect($$("[data-strip-session]").map((item) => item.getAttribute("aria-current"))).toEqual([null, "true"]);
        expect($("[data-messages-segment]")!.hasAttribute("data-rail-weak")).toBe(true);
        wrapper.unmount();
    });

    it("点 bot、会话、新对话发事件；收着时点底段的按钮或“+N”发 show-list，展开着时只切页、对应按钮按下", async () => {
        const {wrapper, expanded, events, tab} = mountFrame();
        $("[data-strip-contact='nbook.bots/vega']")!.click();
        $("[data-strip-session='s1']")!.click();
        $("[data-messages-new-session]")!.click();
        $("[data-messages-open='sessions']")!.click();
        expect(events).toEqual([["open-contact", "nbook.bots/vega"], ["open-session", "s1"], ["new-session"], ["show-list", "sessions"]]);
        expect($$("[data-messages-open]").map((item) => item.getAttribute("aria-pressed"))).toEqual(["false", "false"]);

        events.length = 0;
        expanded.value = true;
        await nextTick();
        expect($$("[data-messages-open]").map((item) => item.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
        $("[data-messages-open='sessions']")!.click();
        await nextTick();
        expect(events).toEqual([["update:tab", "sessions"]]);
        expect(tab.value).toBe("sessions");
        expect($$("[data-messages-open]").map((item) => item.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
        wrapper.unmount();
    });

    it("展开：中段是完整列表；宿主请求展开之后调 focusSearch，列表挂上就聚焦这一页的搜索框；Esc 在已空的框里发 escape-search", async () => {
        const {wrapper, expanded, frame, events} = mountFrame();
        frame().focusSearch("bot");
        expanded.value = true;
        await nextTick();
        await nextTick();
        expect($("[data-messages-segment]")!.getAttribute("data-messages-segment-state")).toBe("expanded");
        const search = $<HTMLInputElement>("[data-messages-page='bot'] input")!;
        expect(document.activeElement).toBe(search);
        search.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        expect(events).toEqual([["escape-search"]]);

        // 展开着再调：直接聚焦。
        (document.activeElement as HTMLElement).blur();
        frame().focusSearch("bot");
        expect(document.activeElement).toBe(search);
        wrapper.unmount();
    });

    it("收起再展开：bot 页的搜索词留在宿主", async () => {
        const {wrapper, expanded, frame, botQuery} = mountFrame({expanded: true});
        const input = () => $<HTMLInputElement>("[data-messages-page='bot'] input")!;
        input().value = "璃";
        input().dispatchEvent(new Event("input", {bubbles: true}));
        await nextTick();
        expect(botQuery.value).toBe("璃");
        expanded.value = false;
        await nextTick();
        expect($("[data-messages-page='bot']")).toBeNull();
        frame().focusSearch("sessions");
        expanded.value = true;
        await nextTick();
        expect(input().value).toBe("璃");
        expect($$("[data-messages-contact]")).toHaveLength(1);
        wrapper.unmount();
    });

    it("从侧轨换到右边缘：同一份列表搬过来、搜索词不丢，聊天区不重挂；none 时不画视图段", async () => {
        const {wrapper, placement, expanded} = mountFrame({expanded: true});
        const list = $("[data-messages-list-panel]")!;
        const input = $<HTMLInputElement>("[data-messages-page='bot'] input")!;
        input.value = "织";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        placement.value = {kind: "edge", width: 260};
        await nextTick();
        const edge = wrapper.get<HTMLElement>(".acv-messages__edge");
        expect(edge.element.style.width).toBe("260px");
        expect(edge.element.contains(list)).toBe(true);
        expect($<HTMLInputElement>("[data-messages-page='bot'] input")!.value).toBe("织");
        expect(chatMounts).toBe(1);

        expanded.value = false;
        await nextTick();
        // 右边缘没有侧轨来管 Tab：各项照常可聚焦，底段画在中段下面。
        expect(edge.element.querySelector("[data-messages-segment]")).not.toBeNull();
        expect(edge.element.querySelector("[data-messages-open='bot']")).not.toBeNull();

        placement.value = {kind: "none"};
        await nextTick();
        expect($("[data-messages-segment]")).toBeNull();
        expect(chatMounts).toBe(1);
        wrapper.unmount();
    });
});

describe("AgentMessagesList", () => {
    const list = (sections: readonly MessagesContactSection[], tab: "bot" | "sessions" = "bot") => mount(AgentMessagesList, {
        props: {tab, sections, selectedContact: "nbook.bots/lyra", now: NOW, locale: "zh-CN"},
        slots: {sessions: () => h("div", {"data-probe-sessions": ""}, "会话面板")},
        attachTo: document.body,
    });

    it("两个标签：bot 标签带未读合计，点标签发 update:tab；会话页是插槽", async () => {
        const wrapper = list(SECTIONS);
        expect(wrapper.get("[data-messages-tab='bot']").text()).toContain("2");
        expect(wrapper.get("[data-messages-tab='bot']").attributes("aria-controls")).toBe(wrapper.get("[data-messages-page='bot']").attributes("id"));
        await wrapper.get("[data-messages-tab='sessions']").trigger("click");
        expect(wrapper.emitted("update:tab")).toEqual([["sessions"]]);
        const sessions = list(SECTIONS, "sessions");
        expect(shown(sessions.get<HTMLElement>("[data-messages-page='sessions']").element)).toBe(true);
        expect(sessions.get("[data-probe-sessions]").text()).toBe("会话面板");
    });

    it("两个标签是一组 tablist：当前页是 Tab 停靠点，方向键换页并把焦点带过去，到头回绕", async () => {
        const tab = ref<"bot" | "sessions">("bot");
        const wrapper = mount({render: () => h(AgentMessagesList, {
            tab: tab.value,
            sections: SECTIONS,
            selectedContact: null,
            now: NOW,
            locale: "zh-CN",
            "onUpdate:tab": (next: "bot" | "sessions") => {
                tab.value = next;
            },
        })}, {attachTo: document.body});
        const bot = wrapper.get<HTMLElement>("[data-messages-tab='bot']");
        const sessions = wrapper.get<HTMLElement>("[data-messages-tab='sessions']");
        expect(wrapper.get("[role='tablist']").attributes("aria-label")).toBe("消息列表");
        expect([bot.attributes("aria-selected"), bot.attributes("tabindex"), sessions.attributes("aria-selected"), sessions.attributes("tabindex")]).toEqual(["true", "0", "false", "-1"]);

        bot.element.focus();
        await bot.trigger("keydown", {key: "ArrowRight"});
        await nextTick();
        expect(tab.value).toBe("sessions");
        expect(document.activeElement).toBe(sessions.element);
        expect([sessions.attributes("aria-selected"), sessions.attributes("tabindex"), bot.attributes("tabindex")]).toEqual(["true", "0", "-1"]);

        await sessions.trigger("keydown", {key: "ArrowRight"});
        await nextTick();
        expect(tab.value).toBe("bot");
        expect(document.activeElement).toBe(bot.element);

        await bot.trigger("keydown", {key: "End"});
        await nextTick();
        expect(tab.value).toBe("sessions");
        expect(document.activeElement).toBe(sessions.element);
        await sessions.trigger("keydown", {key: "Home"});
        await nextTick();
        expect(tab.value).toBe("bot");
        expect(document.activeElement).toBe(bot.element);
        wrapper.unmount();
    });

    it("切换行的右端是插槽", () => {
        const wrapper = mount(AgentMessagesList, {
            props: {tab: "bot", sections: SECTIONS, selectedContact: null, now: NOW, locale: "zh-CN"},
            slots: {sessions: () => null, "switch-end": () => h("button", {"data-probe-end": ""}, "收起")},
        });
        expect(wrapper.get("[data-messages-switch]").find("[data-probe-end]").exists()).toBe(true);
    });

    it("bot 行：第二行在跑写“正在回复…”、等你写“等你处理”、平时写最后一句话、没有写还没有消息；未读数；选中的行", () => {
        const wrapper = list(SECTIONS);
        const rows = wrapper.findAll("[data-messages-contact]");
        expect(rows.map((row) => row.find(".acv-messages-list__second").text())).toEqual(["这周的简报写好了。", "等你处理", "正在回复…"]);
        expect(rows[1]!.get(".acv-messages-list__second").attributes("data-activity")).toBe("waiting");
        expect(rows.map((row) => row.find("[data-messages-unread]").exists())).toEqual([true, false, false]);
        expect(rows[0]!.attributes("aria-current")).toBe("true");
        const quiet = list([{key: "a", state: {kind: "ready"}, contacts: [{key: "a/x", name: "安静", unread: null, activity: "idle", last: null}]}]);
        expect(quiet.get(".acv-messages-list__second").text()).toBe("还没有消息");
    });

    it("搜索按名字筛；没有命中写没有匹配；加载中、失败（重试发 retry-contacts）、空", async () => {
        const wrapper = list(SECTIONS);
        await wrapper.get("[data-messages-search] input, input[data-messages-search]").setValue("璃");
        expect(wrapper.findAll("[data-messages-contact]")).toHaveLength(1);
        await wrapper.get("[data-messages-search] input, input[data-messages-search]").setValue("不存在");
        expect(wrapper.find("[data-messages-no-match]").exists()).toBe(true);

        expect(list([{key: "a", state: {kind: "loading"}, contacts: []}]).find("[data-messages-loading]").exists()).toBe(true);
        const failed = list([{key: "a", state: {kind: "failed", message: "读不到 bot 列表（disconnected）。"}, contacts: []}]);
        expect(failed.get("[data-messages-failed='a']").text()).toContain("disconnected");
        await failed.get("[data-messages-retry='a']").trigger("click");
        expect(failed.emitted("retry-contacts")).toEqual([["a"]]);
        expect(list([{key: "a", state: {kind: "ready"}, contacts: []}]).find("[data-messages-empty]").exists()).toBe(true);
    });

    it("搜索框里 Esc：有字先清空（bot 页的词经 v-model:botQuery 交回），已空时发 escape-search；会话页插槽里的搜索框同样", async () => {
        const query = ref("璃");
        const escapes: string[] = [];
        const sessionQuery = ref("第三章");
        const wrapper = mount({render: () => h(AgentMessagesList, {
            tab: "bot",
            sections: SECTIONS,
            selectedContact: null,
            now: NOW,
            locale: "zh-CN",
            botQuery: query.value,
            "onUpdate:botQuery": (next: string) => {
                query.value = next;
            },
            onEscapeSearch: () => escapes.push("escape"),
        }, {sessions: () => h("input", {"data-probe-session-search": "", value: sessionQuery.value, onInput: (event: Event) => {
            sessionQuery.value = (event.target as HTMLInputElement).value;
        }})})}, {attachTo: document.body});
        const input = wrapper.get<HTMLInputElement>("[data-messages-page='bot'] input");
        expect(input.element.value).toBe("璃");
        expect(wrapper.findAll("[data-messages-contact]")).toHaveLength(1);
        await input.trigger("keydown", {key: "Escape"});
        expect(query.value).toBe("");
        expect(escapes).toEqual([]);
        await input.trigger("keydown", {key: "Escape"});
        expect(escapes).toEqual(["escape"]);

        const session = wrapper.get<HTMLInputElement>("[data-probe-session-search]");
        await session.trigger("keydown", {key: "Escape"});
        expect(sessionQuery.value).toBe("");
        expect(escapes).toEqual(["escape"]);
        wrapper.unmount();
    });

    it("focusSearch 把焦点给这一页的搜索框：bot 页是自己的，会话页是插槽里的第一个输入框", async () => {
        const wrapper = mount(AgentMessagesList, {
            props: {tab: "bot", sections: SECTIONS, selectedContact: null, now: NOW, locale: "zh-CN"},
            slots: {sessions: () => h("input", {"data-probe-session-search": ""})},
            attachTo: document.body,
        });
        (wrapper.vm as unknown as {focusSearch(page: "bot" | "sessions"): void}).focusSearch("bot");
        expect(document.activeElement).toBe(wrapper.get("[data-messages-page='bot'] input").element);
        (wrapper.vm as unknown as {focusSearch(page: "bot" | "sessions"): void}).focusSearch("sessions");
        expect(document.activeElement).toBe(wrapper.get("[data-probe-session-search]").element);
        wrapper.unmount();
    });
});
