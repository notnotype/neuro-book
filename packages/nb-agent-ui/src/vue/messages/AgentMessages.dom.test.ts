/**
 * AgentMessages 与 AgentMessagesList（同名 .md）：版式只换位置与显隐、聊天区不重挂；窄版的头像列与抽屉；列表的两个标签与各种状态。
 * 真实的宽度（宿主量出来给 `layout`）、抽屉的位置与阴影在 e2e 与 Lab 里看。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, nextTick, onMounted, ref} from "vue";

import type {MessagesContactSection} from "../../types";
import AgentMessages from "./AgentMessages.vue";
import AgentMessagesList from "./AgentMessagesList.vue";

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

let chatMounts = 0;
const Chat = defineComponent({setup: () => {
    onMounted(() => {
        chatMounts += 1;
    });
    return () => h("div", {"data-probe-chat": ""}, [h("textarea", {"data-probe-input": ""})]);
}});

/** 像宿主那样持有几个受控值。 */
function mountFrame(initial: {layout?: "wide" | "narrow"; drawerOpen?: boolean; listCollapsed?: boolean} = {}) {
    chatMounts = 0;
    const layout = ref(initial.layout ?? "narrow");
    const drawerOpen = ref(initial.drawerOpen ?? false);
    const listCollapsed = ref(initial.listCollapsed ?? false);
    const tab = ref<"bot" | "sessions">("bot");
    const opened: string[] = [];
    const sessions: string[] = [];
    const Host = defineComponent({setup: () => () => h(AgentMessages, {
        layout: layout.value,
        drawerOpen: drawerOpen.value,
        listCollapsed: listCollapsed.value,
        tab: tab.value,
        sections: SECTIONS,
        selected: {kind: "contact", key: "nbook.bots/lyra"},
        recentSessions: [{id: "s1", title: "第三章节奏调整", icon: "i-lucide-feather"}],
        now: NOW,
        locale: "zh-CN",
        "onUpdate:drawerOpen": (open: boolean) => {
            drawerOpen.value = open;
        },
        "onUpdate:listCollapsed": (collapsed: boolean) => {
            listCollapsed.value = collapsed;
        },
        "onUpdate:tab": (next: "bot" | "sessions") => {
            tab.value = next;
        },
        onOpenContact: (key: string) => opened.push(key),
        onOpenSession: (id: string) => sessions.push(id),
    }, {default: () => h(Chat), sessions: () => h("div", {"data-probe-sessions": ""}, "会话面板")})});
    const wrapper = mount(Host, {attachTo: document.body});
    return {wrapper, layout, drawerOpen, listCollapsed, tab, opened, sessions};
}

const panel = (wrapper: ReturnType<typeof mountFrame>["wrapper"]) => wrapper.get<HTMLElement>("[data-messages-list-panel]");
const shown = (element: HTMLElement): boolean => element.style.display !== "none";

describe("AgentMessages", () => {
    it("换版式只换位置与显隐：聊天区不重挂；宽版列表栏常驻、没有头像列，窄版有头像列、列表收着", async () => {
        const frame = mountFrame({layout: "wide"});
        expect(frame.wrapper.get("[data-messages-layout]").attributes("data-messages-layout")).toBe("wide");
        expect(shown(panel(frame.wrapper).element)).toBe(true);
        expect(shown(frame.wrapper.get<HTMLElement>("[data-messages-strip]").element)).toBe(false);
        frame.layout.value = "narrow";
        await flushPromises();
        expect(shown(panel(frame.wrapper).element)).toBe(false);
        expect(shown(frame.wrapper.get<HTMLElement>("[data-messages-strip]").element)).toBe(true);
        frame.layout.value = "wide";
        await flushPromises();
        expect(chatMounts).toBe(1);
    });

    it("宽版收起列表栏：左边换成头像列，焦点到展开按钮；展开后焦点回到收起按钮", async () => {
        const frame = mountFrame({layout: "wide"});
        await frame.wrapper.get("[data-messages-collapse]").trigger("click");
        await flushPromises();
        expect(frame.listCollapsed.value).toBe(true);
        expect(shown(frame.wrapper.get<HTMLElement>("[data-messages-strip]").element)).toBe(true);
        expect(document.activeElement).toBe(frame.wrapper.get("[data-messages-toggle]").element);
        await frame.wrapper.get("[data-messages-toggle]").trigger("click");
        await flushPromises();
        expect(frame.listCollapsed.value).toBe(false);
        expect(document.activeElement).toBe(frame.wrapper.get("[data-messages-collapse]").element);
    });

    it("窄版头像列：联系人头像，有未读写点、等你处理的点是黄色；名称带未读数；最近会话；点了发事件", async () => {
        const frame = mountFrame();
        const contacts = frame.wrapper.findAll("[data-strip-contact]");
        expect(contacts.map((button) => button.attributes("aria-label"))).toEqual(["星璃，2 条未读", "织女", "新星"]);
        expect(contacts[0]!.find(".acv-messages__strip-dot").exists()).toBe(true);
        expect(contacts[1]!.find("[data-strip-waiting]").exists()).toBe(true);
        expect(contacts[2]!.find(".acv-messages__strip-dot").exists()).toBe(false);
        await frame.wrapper.get("[data-strip-session='s1']").trigger("click");
        expect(frame.sessions).toEqual(["s1"]);
        await contacts[1]!.trigger("click");
        expect(frame.opened).toEqual(["nbook.bots/vega"]);
    });

    it("抽屉：头像列的按钮开，焦点进搜索框；Esc 关、焦点回按钮；里面已处理的 Esc 不关", async () => {
        const frame = mountFrame();
        const toggle = frame.wrapper.get<HTMLElement>("[data-messages-toggle]");
        await toggle.trigger("click");
        await flushPromises();
        expect(frame.drawerOpen.value).toBe(true);
        expect(panel(frame.wrapper).attributes("role")).toBe("dialog");
        expect(toggle.attributes("aria-expanded")).toBe("true");
        expect(document.activeElement?.closest("[data-messages-search]")).not.toBeNull();

        // 里面的控件处理过（例如关掉自己的菜单）：抽屉不关。
        const handled = new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true});
        handled.preventDefault();
        document.activeElement!.dispatchEvent(handled);
        await flushPromises();
        expect(frame.drawerOpen.value).toBe(true);

        document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
        await flushPromises();
        expect(frame.drawerOpen.value).toBe(false);
        expect(document.activeElement).toBe(toggle.element);
    });

    it("抽屉：点视图里的聊天区关；点视图之外（传送出去的浮层、面板头）不关；点了联系人关", async () => {
        const frame = mountFrame({drawerOpen: true});
        const overlay = document.createElement("div");
        document.body.append(overlay);
        overlay.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        await flushPromises();
        expect(frame.drawerOpen.value).toBe(true);
        frame.wrapper.get("[data-probe-chat]").element.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        await flushPromises();
        expect(frame.drawerOpen.value).toBe(false);

        await frame.wrapper.get("[data-messages-toggle]").trigger("click");
        await flushPromises();
        frame.wrapper.get<HTMLElement>("[data-messages-contact='nbook.bots/lyra']").element.focus();
        await frame.wrapper.get("[data-messages-contact='nbook.bots/lyra']").trigger("click");
        expect(frame.opened).toEqual(["nbook.bots/lyra"]);
        expect(frame.drawerOpen.value).toBe(false);
        // 选了一项：被选的行跟着收起，焦点回到开抽屉的按钮。
        expect(document.activeElement).toBe(frame.wrapper.get("[data-messages-toggle]").element);
    });

    it("窄变宽：开着的抽屉收起，列表成了列表栏、焦点不动；宽变窄：焦点在列表里的放到头像列的按钮", async () => {
        const frame = mountFrame({drawerOpen: true});
        await flushPromises();
        const search = frame.wrapper.get<HTMLElement>("[data-messages-search] input, input[data-messages-search]").element;
        search.focus();
        frame.layout.value = "wide";
        await flushPromises();
        expect(frame.drawerOpen.value).toBe(false);
        expect(shown(panel(frame.wrapper).element)).toBe(true);
        expect(document.activeElement).toBe(search);
        frame.layout.value = "narrow";
        await flushPromises();
        expect(document.activeElement).toBe(frame.wrapper.get("[data-messages-toggle]").element);
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

    it("切换行的右端是插槽：外框在宽版把收起按钮放进去", () => {
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
});
