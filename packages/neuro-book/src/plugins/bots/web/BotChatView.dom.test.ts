/**
 * bot 视图的状态（docs/specs/bots/view.md 输出 2 与“状态与转换”）：真实的 BotChatView，数据由测试给的 store 决定何时到、到什么；
 * 对话组件换成只写出会话 id 的占位（固定会话组件自己的行为在 agent 的测试里）。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {defineComponent, h, ref, shallowRef} from "vue";
import {describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {BotItem} from "../shared/contracts";
import {BOTS_TEXT_NAMESPACE} from "../shared/text";
import BotChatView from "./BotChatView.vue";
import type {BotsStore, EnsureResult, ListState} from "./store";
import {botsCatalogs} from "./text";

const port = testTextPort("zh-CN", {[BOTS_TEXT_NAMESPACE]: botsCatalogs});

const LYRA: BotItem = {id: "lyra", name: "星璃", main: {state: "held"}, unread: 0, latestSeq: 0, seenSeq: 0, last: null};

const Conversation = defineComponent({props: {sessionId: {type: String, required: true}}, setup: (props) => () => h("div", {"data-conversation": props.sessionId})});

function mountView(options: {readonly ensure?: () => Promise<EnsureResult>} = {}) {
    const ensured: string[] = [];
    let reloads = 0;
    const store: BotsStore = {
        items: shallowRef<readonly BotItem[]>([]),
        listState: shallowRef<ListState>({kind: "loading"}),
        noModel: shallowRef<boolean | null>(null),
        reload: () => {
            reloads += 1;
        },
        ensureMain: (botId) => {
            ensured.push(botId);
            return options.ensure?.() ?? Promise.resolve({ok: true, sessionId: `bot-${botId}`});
        },
        markSeen: () => undefined,
        openProviders: () => undefined,
    };
    const context = {id: "nbook.bots.chat", generation: 1, visible: ref(true), location: ref(null)};
    const wrapper = mount(BotChatView, {global: {provide: provideText(port)}, props: {context, store, conversation: Conversation}});
    return {wrapper, store, ensured, reloads: () => reloads};
}

describe("bot 视图的状态", () => {
    it("还没读到有没有模型时等着、不取主对话；读到有，取主对话、画对话；读到没有，只画引导", async () => {
        const {wrapper, store, ensured} = mountView();
        store.items.value = [LYRA];
        store.listState.value = {kind: "ready"};
        await flushPromises();
        expect(wrapper.find("[data-bot-chat-loading]").exists()).toBe(true);
        expect(ensured).toEqual([]);
        store.noModel.value = false;
        await flushPromises();
        expect(ensured).toEqual(["lyra"]);
        expect(wrapper.get("[data-conversation]").attributes("data-conversation")).toBe("bot-lyra");

        const none = mountView();
        none.store.items.value = [LYRA];
        none.store.listState.value = {kind: "ready"};
        none.store.noModel.value = true;
        await flushPromises();
        expect(none.wrapper.find("[data-bot-chat-no-model]").exists()).toBe(true);
        expect(none.ensured).toEqual([]);
    });

    it("bot 列表读不到：写原因与重试，重试重读列表；列表到了自动取主对话", async () => {
        const {wrapper, store, ensured, reloads} = mountView();
        store.noModel.value = false;
        store.listState.value = {kind: "failed", code: "disconnected"};
        await flushPromises();
        expect(wrapper.get("[data-bot-chat-failed]").text()).toContain("读不到 bot 列表（disconnected）");
        await wrapper.get("[data-bot-chat-retry]").trigger("click");
        expect(reloads()).toBe(1);
        expect(ensured).toEqual([]);
        store.listState.value = {kind: "loading"};
        await flushPromises();
        expect(wrapper.find("[data-bot-chat-loading]").exists()).toBe(true);
        store.items.value = [LYRA];
        store.listState.value = {kind: "ready"};
        await flushPromises();
        expect(ensured).toEqual(["lyra"]);
        expect(wrapper.find("[data-conversation]").exists()).toBe(true);
    });

    it("列表读到了、是空的：写还没有 bot，不一直转圈", async () => {
        const {wrapper, store} = mountView();
        store.noModel.value = false;
        store.listState.value = {kind: "ready"};
        await flushPromises();
        expect(wrapper.get("[data-bot-chat-failed]").text()).toContain("还没有可以聊的 bot");
    });

    it("取主对话失败：写原因与重试；列表再变不自动重取，点重试再取", async () => {
        const results: EnsureResult[] = [{ok: false, code: "session-busy"}, {ok: true, sessionId: "bot-lyra"}];
        const {wrapper, store, ensured} = mountView({ensure: () => Promise.resolve(results.shift()!)});
        store.noModel.value = false;
        store.items.value = [LYRA];
        store.listState.value = {kind: "ready"};
        await flushPromises();
        expect(wrapper.get("[data-bot-chat-failed]").text()).toContain("session-busy");
        store.items.value = [{...LYRA, unread: 1, latestSeq: 3}];
        await flushPromises();
        expect(ensured).toEqual(["lyra"]);
        await wrapper.get("[data-bot-chat-retry]").trigger("click");
        await flushPromises();
        expect(ensured).toEqual(["lyra", "lyra"]);
        expect(wrapper.find("[data-conversation]").exists()).toBe(true);
    });

    it("取主对话期间列表更新（例如计数变了）：不重取", async () => {
        let finish!: (result: EnsureResult) => void;
        const {store, ensured} = mountView({ensure: () => new Promise((resolve) => {
            finish = resolve;
        })});
        store.noModel.value = false;
        store.items.value = [LYRA];
        store.listState.value = {kind: "ready"};
        await flushPromises();
        store.items.value = [{...LYRA, unread: 1, latestSeq: 3}];
        await flushPromises();
        expect(ensured).toEqual(["lyra"]);
        finish({ok: true, sessionId: "bot-lyra"});
    });
});
