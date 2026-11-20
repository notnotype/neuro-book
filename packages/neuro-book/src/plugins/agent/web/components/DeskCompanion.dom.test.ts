/**
 * 书房的看板娘入口（同名 .md，docs/specs/agent/conversation.md 输出 54）：入口的几种状态（未读带计数与最后一句、等你处理、没有联系人、
 * 读不到）、心情、点开时借用宿主并打开联系人、没有会话时的盖层、联系人消失时关面板。宿主与归属插件是只实现入口用到的那几样的
 * 响应式替身（同 messages-model.test.ts）；真实宿主、真实 bots 提供者与面板里的对话在 e2e bots-chat 的书房一组。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, ref, shallowRef} from "vue";

import type {SessionOwner} from "@notnotype/nb-harness/kernel/contracts";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {OwnerContact, OwnerContactsState, SessionOwnerProvider} from "../../shared/contracts";
import type {ActivityItem} from "../../shared/remote";
import {AGENT_TEXT_NAMESPACE} from "../../shared/text";
import DeskCompanion from "./DeskCompanion.vue";
import {agentCatalogs} from "../text";

const global = {provide: provideText(testTextPort("zh-CN", {[AGENT_TEXT_NAMESPACE]: agentCatalogs}))};

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const LYRA: OwnerContact = {id: "lyra", name: "星璃", unread: 0, last: null, sessionId: "bot-lyra"};

/** 面板里的对话替身：收 `close`，画一个“关闭”按钮。 */
const Conversation = defineComponent({
    props: {close: {type: Function, required: true}},
    setup(props, {expose}) {
        expose({focusComposer: () => undefined});
        return () => h("button", {type: "button", "data-fake-close": "", onClick: () => (props.close as () => void)()}, "关闭");
    },
});

function setup(contacts: OwnerContact[] = [LYRA]) {
    const contactList = shallowRef(contacts);
    const state = shallowRef<OwnerContactsState>({kind: "ready"});
    const opens: string[] = [];
    const provider: SessionOwnerProvider = {
        contacts: contactList,
        state,
        reload: () => undefined,
        open: async (id) => {
            opens.push(id);
            return {ok: true, sessionId: `bot-${id}`};
        },
        seen: () => undefined,
    };
    const providers = shallowRef([{plugin: "nbook.bots", provider}]);
    const activity = shallowRef<readonly ActivityItem[]>([]);
    const sessionId = ref<string | null>(null);
    const owner = ref<SessionOwner | null | undefined>(null);
    let borrowed = 0;
    const host = {
        sessionId, owner, shownSeq: ref(0), opened: ref(0),
        open: async (id: string) => {
            sessionId.value = id;
            owner.value = {plugin: "nbook.bots", id: id.slice(4)};
        },
        borrow: () => {
            borrowed += 1;
            return () => {
                borrowed -= 1;
            };
        },
    };
    const moods: string[] = [];
    const Host = defineComponent({
        setup() {
            return () => h(DeskCompanion, {
                providers: providers.value, activity: activity.value, hasModel: true, host, conversation: Conversation,
                openModelSettings: () => undefined, ensureStarted: () => undefined,
                "onUpdate:mood": (mood: string) => moods.push(mood),
            });
        },
    });
    const wrapper = mount(Host, {global, attachTo: document.body});
    mounted.push(wrapper);
    return {wrapper, contactList, state, providers, activity, opens, moods, host, borrowed: () => borrowed};
}

const button = (): HTMLButtonElement | null => document.querySelector("[data-desk-companion-button]");
const badge = (): string | null => document.querySelector("[data-desk-badge]")?.textContent?.trim() ?? null;
const bubble = (): string | null => document.querySelector("[data-desk-bubble]")?.textContent?.trim() ?? null;
const panel = (): Element | null => document.querySelector("[data-side-panel]");

describe("书房的看板娘入口", () => {
    it("没有未读时不加东西；有未读时右上角计数、气泡写最后一句；等你处理时换成“!”与“等你处理”、猫换提问的表情", async () => {
        const {contactList, activity, moods} = setup();
        await flushPromises();
        expect(button()?.getAttribute("aria-label")).toBe("星璃");
        expect(badge()).toBeNull();
        expect(bubble()).toBeNull();
        expect(moods.at(-1)).toBe("idle");

        contactList.value = [{...LYRA, unread: 3, last: {text: "新书榜的类型我数完了，要看看吗？", at: 1}}];
        await flushPromises();
        expect(badge()).toBe("3");
        expect(bubble()).toBe("新书榜的类型我数完了，要看看吗？");
        expect(button()?.getAttribute("aria-label")).toBe("星璃，3 条未读");

        contactList.value = [{...LYRA, unread: 120, last: {text: "又一句", at: 2}}];
        await flushPromises();
        expect(badge()).toBe("99+");

        // 子代理在等也算这个 bot 在等（按会话树的根）。
        activity.value = [{id: "child-1", state: "waiting", root: "bot-lyra"}];
        await flushPromises();
        expect(badge()).toBe("!");
        expect(bubble()).toBe("等你处理");
        expect(button()?.getAttribute("aria-label")).toBe("星璃，等你处理");
        expect(moods.at(-1)).toBe("ask");
    });

    it("没有联系人时是不能点的猫；读不到时提示原因", async () => {
        const {state, contactList} = setup([]);
        await flushPromises();
        expect(button()).toBeNull();
        state.value = {kind: "failed", code: "disconnected"};
        contactList.value = [];
        await flushPromises();
        expect(document.querySelector("[data-desk-companion]")?.getAttribute("title")).toBe("读不到 bot（disconnected）");
    });

    it("点开：借用宿主、取这个联系人的主对话并打开；关上交还借用；面板里没有会话时盖着“找不到 bot”", async () => {
        const {opens, host, borrowed} = setup();
        await flushPromises();
        button()!.click();
        await flushPromises();
        expect(panel()).not.toBeNull();
        expect(borrowed()).toBe(1);
        expect(opens).toEqual(["lyra"]);
        expect(host.sessionId.value).toBe("bot-lyra");
        expect(document.querySelector("[data-messages-cover]")).toBeNull();

        (document.querySelector("[data-fake-close]") as HTMLButtonElement).click();
        await flushPromises();
        expect(panel()).toBeNull();
        expect(borrowed()).toBe(0);

        // 面板开着、宿主却没有会话（例如主对话被别处关了）：盖“找不到 bot”，不露出会隐式新建会话的第一屏。
        button()!.click();
        await flushPromises();
        host.sessionId.value = null;
        await flushPromises();
        expect(document.querySelector("[data-messages-missing]")).not.toBeNull();
    });

    it("联系人消失（bots 停用）时关面板、交还借用；联系人回来后面板不自己弹开", async () => {
        const {providers, borrowed} = setup();
        await flushPromises();
        const before = providers.value;
        button()!.click();
        await flushPromises();
        expect(panel()).not.toBeNull();
        providers.value = [];
        await flushPromises();
        expect(panel()).toBeNull();
        expect(borrowed()).toBe(0);
        providers.value = before;
        await flushPromises();
        expect(button()).not.toBeNull();
        expect(panel()).toBeNull();
    });
});
