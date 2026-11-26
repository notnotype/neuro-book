/**
 * 消息视图的状态（docs/specs/agent/conversation.md 输出 1–3、53，docs/specs/bots/view.md）。宿主与归属插件是只实现消息视图用到的那几样的
 * 响应式替身：真实宿主的档位与打开在 session-host.test.ts，真实的 bots 提供者在 e2e bots-chat。
 */

import {describe, expect, it} from "bun:test";
import {nextTick, ref, shallowRef} from "vue";

import type {SessionOwner} from "@notnotype/nb-harness/kernel/contracts";

import type {OwnerContact, OwnerContactsState, SessionOwnerProvider} from "../shared/contracts";
import type {ActivityItem} from "../shared/remote";
import {createMessagesModel} from "./messages-model";

function deferred<T>(): {readonly promise: Promise<T>; resolve(value: T): void} {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => {
        resolve = settle;
    });
    return {promise, resolve};
}

function provider(contacts: OwnerContact[] = [{id: "lyra", name: "星璃", unread: 2, seenSeq: 0, last: {text: "好了", at: 1}, sessionId: "bot-lyra"}, {id: "vega", name: "织女", unread: 0, seenSeq: 0, last: null, sessionId: "bot-vega"}]) {
    const opens: string[] = [];
    const seen: [string, number][] = [];
    let reloads = 0;
    let next: () => Promise<{readonly ok: true; readonly sessionId: string} | {readonly ok: false; readonly code: string}> = async () => ({ok: true, sessionId: "bot-lyra"});
    const state = shallowRef<OwnerContactsState>({kind: "ready"});
    const value: SessionOwnerProvider = {
        contacts: shallowRef(contacts),
        state,
        reload: () => {
            reloads += 1;
        },
        open: (id) => {
            opens.push(id);
            return next();
        },
        seen: (id, seq) => void seen.push([id, seq]),
    };
    return {value, opens, seen, state, reloads: () => reloads, answer: (fn: typeof next) => {
        next = fn;
    }};
}

function setup(options: {hasModel?: boolean | null} = {}) {
    const bots = provider();
    const providers = shallowRef([{plugin: "nbook.bots", provider: bots.value}]);
    const activity = shallowRef<readonly ActivityItem[]>([]);
    const hasModel = ref<boolean | null>(options.hasModel === undefined ? true : options.hasModel);
    const sessionId = ref<string | null>(null);
    const owner = ref<SessionOwner | null | undefined>(null);
    const shownSeq = ref(0);
    const openCount = ref(0);
    const opened: string[] = [];
    const selectedSessions: string[] = [];
    const host = {
        sessionId, owner, shownSeq, opened: openCount,
        open: async (id: string) => {
            opened.push(id);
            openCount.value += 1;
            sessionId.value = id;
            // 同真宿主：换了会话，已应用的 seq 从 0 起。
            shownSeq.value = 0;
            owner.value = id.startsWith("bot-") ? {plugin: "nbook.bots", id: id.slice(4)} : null;
        },
    };
    const model = createMessagesModel({
        host,
        providers: () => providers.value,
        activity: () => activity.value,
        hasModel: () => hasModel.value,
        sessions: () => [
            {id: "s1", title: "一", icon: "i-lucide-feather"},
            {id: "s3", title: ""},
            {id: "s4", title: "四"},
            {id: "s5", title: "五"},
            {id: "s6", title: "六"},
            {id: "s7", title: "七"},
        ],
        selectSession: (id) => {
            selectedSessions.push(id);
            void host.open(id);
        },
        texts: {contactsFailed: (code) => `读不到联系人（${code}）`, untitled: () => "未命名"},
    });
    return {model, bots, providers, activity, hasModel, host, opened, selectedSessions};
}

describe("消息视图的状态", () => {
    it("联系人按归属插件分段，跟着提供者的发布与撤回变；第二行按会话树的根：子代理在等也算这个 bot 在等；读不到写原因", async () => {
        const {model, providers, activity, bots} = setup();
        expect(model.sections.value[0]!.contacts[0]).toMatchObject({key: "nbook.bots/lyra", name: "星璃", unread: 2, activity: "idle"});
        activity.value = [{id: "child-1", state: "waiting", root: "bot-lyra"}, {id: "bot-lyra", state: "running", root: "bot-lyra"}];
        expect(model.sections.value[0]!.contacts[0]!.activity).toBe("waiting");
        bots.state.value = {kind: "failed", code: "disconnected"};
        expect(model.sections.value[0]!.state).toEqual({kind: "failed", message: "读不到联系人（disconnected）"});
        providers.value = [];
        expect(model.sections.value).toEqual([]);
    });

    it("点联系人：取到主对话后在聊天区打开，标签切到 bot、选中这个联系人；取不到写原因，重试再取", async () => {
        const {model, bots, opened} = setup();
        bots.answer(async () => ({ok: false, code: "session-busy"}));
        await model.openContact("nbook.bots/lyra");
        expect(model.pending.value).toMatchObject({step: "failed", code: "session-busy", name: "星璃"});
        expect(opened).toEqual([]);
        bots.answer(async () => ({ok: true, sessionId: "bot-lyra"}));
        await model.openContact("nbook.bots/lyra");
        await nextTick();
        expect(opened).toEqual(["bot-lyra"]);
        expect(model.pending.value).toBeNull();
        expect(model.tab.value).toBe("bot");
        expect(model.selected.value).toEqual({kind: "contact", key: "nbook.bots/lyra"});
    });

    it("没有模型不取主对话、盖“没有模型”；配好了接着打开；还没读到时先等", async () => {
        const {model, bots, hasModel, opened} = setup({hasModel: false});
        await model.openContact("nbook.bots/lyra");
        expect(model.pending.value).toMatchObject({step: "no-model"});
        expect(bots.opens).toEqual([]);
        hasModel.value = true;
        await nextTick();
        await new Promise((resolve) => setImmediate(resolve));
        expect(bots.opens).toEqual(["lyra"]);
        expect(opened).toEqual(["bot-lyra"]);

        const waiting = setup({hasModel: null});
        await waiting.model.openContact("nbook.bots/lyra");
        expect(waiting.model.pending.value).toMatchObject({step: "opening"});
        expect(waiting.bots.opens).toEqual([]);
        waiting.hasModel.value = false;
        await nextTick();
        expect(waiting.model.pending.value).toMatchObject({step: "no-model"});
    });

    it("取主对话期间点了会话：较早的结果不再打开，标签跟着会话切到会话", async () => {
        const {model, bots, opened, selectedSessions} = setup();
        const slow = deferred<{readonly ok: true; readonly sessionId: string}>();
        bots.answer(() => slow.promise);
        const opening = model.openContact("nbook.bots/lyra");
        model.openSession("s1");
        slow.resolve({ok: true, sessionId: "bot-lyra"});
        await opening;
        await nextTick();
        expect(selectedSessions).toEqual(["s1"]);
        expect(opened).toEqual(["s1"]);
        expect(model.pending.value).toBeNull();
        expect(model.tab.value).toBe("sessions");
        expect(model.selected.value).toEqual({kind: "session", id: "s1"});
    });

    it("没有打开会话时：停在 bot 一页写“选一个 bot”，会话一页不写", () => {
        const {model} = setup();
        model.tab.value = "bot";
        expect(model.pickBot.value).toBe(true);
        model.tab.value = "sessions";
        expect(model.pickBot.value).toBe(false);
    });

    it("视图段的最近会话：按给的次序（最近活动），没有标题写未命名；视图段按高度再截", () => {
        const {model} = setup();
        expect(model.recentSessions.value.map((item) => item.title)).toEqual(["一", "未命名", "四", "五", "六", "七"]);
    });

    it("最近会话重取：视图段画出来、换了会话、会话面板的列表重取过、窗口回到前台，以及画着时每 15 秒；没画出来时这些都不重取", async () => {
        const {model, host} = setup();
        const shown = ref(false);
        const focused = ref(true);
        const listed = shallowRef<readonly string[]>([]);
        let refreshes = 0;
        const timers: {milliseconds: number; run: () => void; stopped: boolean}[] = [];
        const stop = model.watchRecent({
            shown: () => shown.value,
            focused: () => focused.value,
            listed: () => listed.value,
            refresh: () => {
                refreshes += 1;
            },
            every: (milliseconds, run) => {
                const timer = {milliseconds, run, stopped: false};
                timers.push(timer);
                return () => {
                    timer.stopped = true;
                };
            },
        });
        // 没画出来：换会话、列表变、窗口回来都不取，也没有定时器。
        await host.open("s1");
        listed.value = ["s1"];
        focused.value = false;
        await nextTick();
        focused.value = true;
        await nextTick();
        expect([refreshes, timers.length]).toEqual([0, 0]);

        shown.value = true;
        await nextTick();
        expect(refreshes).toBe(1);
        expect(timers.map((timer) => [timer.milliseconds, timer.stopped])).toEqual([[15_000, false]]);
        timers[0]!.run();
        expect(refreshes).toBe(2);

        await host.open("s4");
        await nextTick();
        expect(refreshes).toBe(3);
        listed.value = ["s1", "s4"];
        await nextTick();
        expect(refreshes).toBe(4);
        focused.value = false;
        await nextTick();
        focused.value = true;
        await nextTick();
        expect(refreshes).toBe(5);

        // 收起来（视图段不画了）停掉定时器；再画出来重取一次、另起一个。
        shown.value = false;
        await nextTick();
        expect(timers[0]!.stopped).toBe(true);
        shown.value = true;
        await nextTick();
        expect([refreshes, timers.length, timers[1]!.stopped]).toEqual([6, 2, false]);
        stop();
        expect(timers[1]!.stopped).toBe(true);
    });

    it("看到：有归属的会话开着、视图可见且窗口有焦点、没有盖层时才交；三样各自不满足时都不交", async () => {
        const {model, bots, host} = setup();
        const active = ref(false);
        const stop = model.watchSeen(() => active.value);
        await host.open("bot-lyra");
        host.shownSeq.value = 7;
        await nextTick();
        expect(bots.seen).toEqual([]);
        active.value = true;
        await nextTick();
        expect(bots.seen).toEqual([["lyra", 7]]);
        await host.open("s1");
        host.shownSeq.value = 9;
        await nextTick();
        expect(bots.seen).toEqual([["lyra", 7]]);
        await host.open("bot-lyra");
        bots.answer(() => new Promise(() => undefined));
        void model.openContact("nbook.bots/vega");
        host.shownSeq.value = 11;
        await nextTick();
        expect(bots.seen).toEqual([["lyra", 7]]);
        stop();
    });

    it("盖层跟着宿主：别处打开了会话（命令、新建、状态栏）就撤掉、较早的结果作废；归属插件停了也撤；点已经开着的联系人什么都不做", async () => {
        const {model, bots, host, opened, providers} = setup();
        bots.answer(async () => ({ok: false, code: "session-busy"}));
        await model.openContact("nbook.bots/lyra");
        expect(model.pending.value).toMatchObject({step: "failed"});
        await host.open("s9");
        expect(model.pending.value).toBeNull();
        expect(model.selected.value).toEqual({kind: "session", id: "s9"});

        const slow = deferred<{readonly ok: true; readonly sessionId: string}>();
        bots.answer(() => slow.promise);
        const opening = model.openContact("nbook.bots/lyra");
        await host.open("s8");
        slow.resolve({ok: true, sessionId: "bot-lyra"});
        await opening;
        expect(opened.at(-1)).toBe("s8");

        bots.answer(() => new Promise(() => undefined));
        void model.openContact("nbook.bots/lyra");
        expect(model.pending.value).toMatchObject({step: "opening"});
        providers.value = [];
        await nextTick();
        expect(model.pending.value).toBeNull();

        const again = setup();
        await again.model.openContact("nbook.bots/lyra");
        await again.model.openContact("nbook.bots/lyra");
        expect(again.bots.opens).toEqual(["lyra"]);
        expect(again.opened).toEqual(["bot-lyra"]);
    });

    it("读不到联系人时重试：调那个归属插件的 reload", () => {
        const {model, bots} = setup();
        model.retryContacts("nbook.bots");
        expect(bots.reloads()).toBe(1);
    });
});
