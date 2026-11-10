import {describe, expect, test} from "bun:test";
import {computed, effectScope, nextTick, ref} from "vue";
import {confirmRelogin, panelState, stopPanelData} from "../src/web/host/panel-data.js";
import {useSessionConsoleHost, type SelectedSession} from "../src/web/host/session-console.js";
import {gate, until, useWebEnv, type FetchCall, type Reply} from "./web-env.js";

/** 会话页的操作（`host/session-console.ts`，L3）：动作绑定发起时的目标（t15 阶段 1.1、1.2）。环境见 `tests/web-env.ts`。 */
// 用例中途失败时也收口数据宿主的单例（关推送、取消重连），不连累同一文件里后面的用例。
const scopes: Array<() => void> = [];
const web = useWebEnv(() => {
    for (const stop of scopes.splice(0)) stop();
    stopPanelData();
});

const A: SelectedSession = {paneId: "w1:p1", terminalId: "term_a", sessionKey: "claude:aaaa", agent: "claude", status: "idle"};
const A2: SelectedSession = {...A, sessionKey: "claude:a222"};
const B: SelectedSession = {paneId: "w2:p1", terminalId: "term_b", sessionKey: "claude:bbbb", agent: "claude", status: "idle"};

const screenOf = (call: FetchCall): Reply | undefined => {
    const match = /^\/api\/sessions\/([^/]+)\/screen\?session=(.+)$/u.exec(call.url);
    if (!match) return undefined;
    return {data: {paneId: decodeURIComponent(match[1]!), sessionKey: decodeURIComponent(match[2]!), agent: "claude", status: "idle", focused: false, screen: `屏幕 ${decodeURIComponent(match[2]!)}`}};
};
const posts = (path: string) => web.env.calls.filter((call) => call.method === "POST" && call.url.endsWith(path));

function mount(initial: SelectedSession | null, terminalAvailable = false) {
    const selected = ref<SelectedSession | null>(initial);
    const scope = effectScope();
    scopes.push(() => scope.stop());
    const host = scope.run(() => useSessionConsoleHost({selected: computed(() => selected.value), terminalAvailable: ref(terminalAvailable)}))!;
    return {selected, host, stop: () => {
        scope.stop();
        stopPanelData();
    }};
}

describe("两步确认绑定打开时的目标（阻断 1）", () => {
    test("按 Enter 开确认，同一格换了会话再确认：不发按键、关掉确认框、提示目标变了", async () => {
        web.env.respond(screenOf);
        web.env.respond((call) => (call.url.endsWith("/keys") ? {data: {sent: ["enter"]}} : undefined));
        const {selected, host, stop} = mount(A);
        await host.pressKey("enter");
        expect(host.confirm.value).toMatchObject({target: {paneId: A.paneId, sessionKey: A.sessionKey}, screen: "屏幕 claude:aaaa"});
        selected.value = A2;
        await nextTick();
        await host.confirmRun();
        expect(posts("/keys")).toEqual([]);
        expect(host.confirm.value).toBeNull();
        expect(host.notice.value).toMatchObject({outcome: "conflict", title: "目标变了，没有发送"});
        stop();
    });

    test("换到另一格 pane 再确认：同样不发；确认框打开着、目标没变时照常发给打开时的那个", async () => {
        web.env.respond(screenOf);
        web.env.respond((call) => (call.url.endsWith("/keys") ? {data: {sent: ["esc"]}} : undefined));
        const {selected, host, stop} = mount(A);
        await host.pressKey("esc");
        selected.value = B;
        await nextTick();
        expect(host.confirm.value).toBeNull();
        expect(host.notice.value?.title).toBe("目标变了，没有发送");
        await host.confirmRun();
        expect(posts("/keys")).toEqual([]);
        await host.pressKey("esc");
        await host.confirmRun();
        expect(posts("/keys").map((call) => [call.url, call.body])).toEqual([["/api/sessions/w2%3Ap1/keys", {keys: ["esc"], expectedSession: B.sessionKey, confirmed: true}]]);
        stop();
    });

    test("文字判定不可投、开了“仍然发送”之后目标变了：不发", async () => {
        web.env.respond(screenOf);
        web.env.respond((call) => (call.url.endsWith("/prompt") ? {status: 409, errors: [{code: "not_deliverable", message: "输入框里有字", details: {screen: "❯ 半截", screenDigest: "d1"}}]} : undefined));
        const {selected, host, stop} = mount(A);
        await host.sendPrompt("你好");
        expect(host.confirm.value).toMatchObject({action: {kind: "prompt", text: "你好", digest: "d1"}});
        selected.value = A2;
        await nextTick();
        await host.confirmRun();
        expect(posts("/prompt").length).toBe(1);
        stop();
    });

    test("读屏挂起期间目标变了：回来的屏幕不写，也不开确认框", async () => {
        const hold = gate();
        web.env.respond((call) => (call.url.includes("w1%3Ap1/screen") ? {...screenOf(call)!, wait: hold.promise} : undefined));
        web.env.respond(screenOf);
        const {selected, host, stop} = mount(A);
        const pressing = host.pressKey("enter");
        await until(() => web.env.calls.filter((call) => call.url.includes("w1%3Ap1/screen")).length, (count) => count >= 2);
        selected.value = B;
        await nextTick();
        hold.open();
        await pressing;
        expect(host.confirm.value).toBeNull();
        await until(() => host.screen.value, (value) => value !== null);
        expect(host.screen.value?.sessionKey).toBe(B.sessionKey);
        stop();
    });

    test("给 A 的发送在途时换到 B：A 的回包不清 B 的草稿；同一格换会话：草稿保留、提示会话换了；换 pane：清空", async () => {
        const hold = gate();
        web.env.respond(screenOf);
        web.env.respond((call) => (call.url.endsWith("/prompt") ? {data: {result: "delivered", code: null, message: "已投递"}, wait: hold.promise} : undefined));
        const {selected, host, stop} = mount(A);
        const reset0 = host.resetKey.value;
        const sending = host.sendPrompt("给 A");
        selected.value = B;
        await nextTick();
        const reset1 = host.resetKey.value;
        expect(reset1).toBe(reset0 + 1);
        hold.open();
        await sending;
        expect(host.resetKey.value).toBe(reset1);
        selected.value = {...B, sessionKey: "claude:b222"};
        await nextTick();
        expect([host.resetKey.value, host.sessionChange.value]).toEqual([reset1, {from: B.sessionKey, to: "claude:b222"}]);
        selected.value = A;
        await nextTick();
        expect([host.resetKey.value, host.sessionChange.value]).toEqual([reset1 + 1, null]);
        stop();
    });
});

describe("阶段 1 实现审查的建议", () => {
    test("建议 1：确认前重读屏幕失败，确认框写明这次没读到、框里是多久以前的画面", async () => {
        let reads = 0;
        web.env.respond((call) => {
            if (!call.url.includes("/screen?")) return undefined;
            reads += 1;
            return reads === 1 ? screenOf(call) : {status: 503, errors: [{code: "herdr_unavailable", message: "herdr 读屏超时"}]};
        });
        const {host, stop} = mount(A);
        await until(() => host.screen.value, (value) => value !== null);
        await host.pressKey("enter");
        expect(host.confirm.value?.screen).toBe("屏幕 claude:aaaa");
        expect(host.confirm.value?.message).toMatch(/这次没读到屏幕（herdr 读屏超时），下面是 \d+ 秒前读到的画面/u);
        stop();
    });

    test("建议 2：发文字在途时同一格换了会话（发的是 /clear）：回包后清空输入框、收起“会话换了”", async () => {
        const hold = gate();
        web.env.respond(screenOf);
        web.env.respond((call) => (call.url.endsWith("/prompt") ? {data: {result: "delivered_maybe_wrong_session", code: null, message: "投递的瞬间换了会话"}, wait: hold.promise} : undefined));
        const {selected, host, stop} = mount(A);
        const reset0 = host.resetKey.value;
        const sending = host.sendPrompt("/clear");
        selected.value = A2;
        await nextTick();
        expect([host.resetKey.value, host.sessionChange.value]).toEqual([reset0, {from: A.sessionKey, to: A2.sessionKey}]);
        hold.open();
        await sending;
        expect([host.resetKey.value, host.sessionChange.value]).toEqual([reset0 + 1, null]);
        stop();
    });

    test("建议 3：给 A 的文字回 not_deliverable 时已经换到 B：不开“仍然发送”，提示带 A 的 pane 号与原文", async () => {
        const hold = gate();
        web.env.respond(screenOf);
        web.env.respond((call) => (call.url.endsWith("/prompt") ? {status: 409, errors: [{code: "not_deliverable", message: "输入框里有字", details: {screen: "❯ 半截", screenDigest: "d1"}}], wait: hold.promise} : undefined));
        const {selected, host, stop} = mount(A);
        const sending = host.sendPrompt("给 A 的话");
        selected.value = B;
        await nextTick();
        hold.open();
        await sending;
        expect(host.confirm.value).toBeNull();
        // notice 是响应式代理，数组属性用 toMatchObject 比不上，拆成普通值比。
        expect([host.notice.value?.outcome, host.notice.value?.title, [...(host.notice.value?.items ?? [])]]).toEqual(["failure", "没有发出去", ["原文：给 A 的话"]]);
        expect(host.notice.value?.message).toContain(`窗格 ${A.paneId}`);
        stop();
    });

    test("建议 1：读到了就用这一次的屏幕，说明里不写旧画面", async () => {
        let reads = 0;
        web.env.respond((call) => {
            if (!call.url.includes("/screen?")) return undefined;
            reads += 1;
            return {data: {paneId: A.paneId, sessionKey: A.sessionKey, agent: "claude", status: "idle", focused: false, screen: `第 ${reads} 屏`}};
        });
        const {host, stop} = mount(A);
        await until(() => host.screen.value, (value) => value !== null);
        await host.pressKey("esc");
        expect([host.confirm.value?.screen, host.confirm.value?.message.includes("没读到")]).toEqual(["第 2 屏", false]);
        stop();
    });
});

describe("终端连接与接管（重要 3、阻断 1 的接管）", () => {
    test("同一格换会话不重建连接；换 pane 时关掉旧连接、连序号加一", async () => {
        web.env.respond(screenOf);
        const {selected, host, stop} = mount(A, true);
        expect([host.connection.value, web.env.sockets().length]).toEqual([1, 1]);
        const first = web.env.sockets()[0]!;
        expect(first.url).toContain("terminal=term_a");
        selected.value = A2;
        await nextTick();
        expect([host.connection.value, web.env.sockets().length, first.closedWith]).toEqual([1, 1, null]);
        selected.value = B;
        await nextTick();
        expect([host.connection.value, web.env.sockets().length]).toEqual([2, 2]);
        expect(first.closedWith).not.toBeNull();
        expect(web.env.sockets()[1]!.url).toContain("terminal=term_b");
        stop();
    });

    test("非 Agent 的 pane（会话键为空，只读观看）：建终端连接，不读屏", async () => {
        web.env.respond(screenOf);
        const {host, stop} = mount({paneId: "w9:p2", terminalId: "term_log", sessionKey: "", agent: null, status: "unknown"}, true);
        await nextTick();
        expect(web.env.sockets().map((socket) => socket.url.includes("terminal=term_log"))).toEqual([true]);
        expect(web.env.calls.filter((call) => call.url.includes("/screen"))).toEqual([]);
        expect(await host.readScreen()).toBeNull();
        stop();
    });

    test("接管小窗打开期间目标变了：确认不发接管；need_confirm 之后目标变了：不再开“抢过来”", async () => {
        web.env.respond(screenOf);
        const {selected, host, stop} = mount(A, true);
        const socket = web.env.sockets()[0]!;
        socket.open();
        host.askTakeover(100, 30);
        selected.value = A2;
        await nextTick();
        host.confirmTakeover();
        expect(socket.sent.filter((line) => line.includes("takeover"))).toEqual([]);
        expect(host.notice.value?.title).toBe("目标变了，没有发送");
        host.askTakeover(100, 30);
        host.confirmTakeover();
        expect(JSON.parse(socket.sent.find((line) => line.includes("takeover"))!)).toMatchObject({t: "takeover", cols: 100, rows: 30, expectedSession: A2.sessionKey, force: false});
        selected.value = {...A2, sessionKey: "claude:a333"};
        await nextTick();
        socket.push({t: "need_confirm", reason: "controlled_elsewhere", detail: {}});
        await nextTick();
        expect(host.takeoverAsk.value).toBeNull();
        stop();
    });

    test("need_confirm 时目标没变：“抢过来”沿用发起接管时的目标与尺寸", async () => {
        web.env.respond(screenOf);
        const {host, stop} = mount(A, true);
        const socket = web.env.sockets()[0]!;
        socket.open();
        host.askTakeover(120, 40);
        host.confirmTakeover();
        socket.push({t: "need_confirm", reason: "other_browser", detail: {since: "2026-10-13T00:00:00Z"}});
        await nextTick();
        expect(host.takeoverAsk.value).toMatchObject({target: {sessionKey: A.sessionKey}, cols: 120, rows: 40, force: true});
        stop();
    });
});

describe("重新登录之后（1.5）", () => {
    test("登录失效时关掉终端连接；重新登录后按新的 authEpoch 重建连接", async () => {
        let lost = false;
        web.env.respond((call) => (lost && call.url !== "/api/meta" ? {status: 401} : undefined));
        web.env.respond(screenOf);
        web.env.respond((call) => (call.url === "/api/meta" ? {data: {}} : undefined));
        const {host, stop} = mount(A, true);
        expect([host.connection.value, web.env.sockets().length]).toEqual([1, 1]);
        lost = true;
        await host.readScreen();
        expect(panelState.unauthorized).toBe(true);
        await nextTick();
        expect(web.env.sockets()[0]!.closedWith).not.toBeNull();
        expect(host.terminal.value).toBeNull();
        lost = false;
        expect(await confirmRelogin()).toBeNull();
        await nextTick();
        expect(host.connection.value).toBe(2);
        expect(web.env.sockets().at(-1)!.url).toContain("terminal=term_a");
        stop();
    });
});
