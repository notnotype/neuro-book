/**
 * 实例里的时序（docs/specs/settings/configuration.md 输出 8、15–17，“时序与寿命”）：到层拥有者的路按 `LayerLink`
 * 的合同手写，用来摆出真实内核里难以稳定复现的先后（订阅建立期间被结束、写入结果晚于推送到达）；这些先后只在这里
 * 覆盖。真实内核与链路上的就绪、截止后晚到、重订与写入由 `settings.test.ts` 覆盖。
 */

import {describe, expect, it} from "bun:test";

import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";
import {Type} from "typebox";

import type {WindowConnection, WindowConnectionState} from "nbook/shared/host";
import {defineSetting} from "nbook/shared/settings";

import {createSettingsInstance, FIRST_SNAPSHOT_MS} from "./instance";
import type {LayerLink, LinkSubscribe} from "./instance";
import type {DeclaredSetting, LayerSnapshot, LayerWriteResult} from "./layers";

const title = {"zh-CN": "项", "en-US": "Item"};
const theme = defineSetting({plugin: "x.ui", name: "theme", schema: Type.String(), default: "nbook", title});
const size = defineSetting({plugin: "x.ui", name: "size", schema: Type.Number(), default: 12, title});
const declarations = new Map<string, DeclaredSetting>([theme, size].map((setting) => [setting.key, {plugin: "x.ui", declaration: setting.declaration}]));
const consumer: ConsumerIdentity = {instanceId: "w", location: "browser", client: "c", plugin: "x.ui", entry: "browser", generation: 1, via: null};

function snapshot(seq: number, values: Record<string, unknown>, status: "ok" | "invalid" = "ok"): LayerSnapshot {
    return status === "ok" ? {status, revision: {boot: "b", seq}, values, problems: []} : {status, revision: {boot: "b", seq}, values, problems: [], detail: "坏了"};
}

/** 手写的路：测试决定订阅何时推什么、何时结束、建立结果何时返回。 */
class ScriptedLink implements LayerLink {
    subscriptions = 0;
    push: (snapshot: LayerSnapshot) => void = () => undefined;
    end: (reason: string, retry: boolean) => void = () => undefined;
    /** 下一次订阅的建立结果；null 表示等测试 `settle`。 */
    next: LinkSubscribe | null = {ok: true, release: () => undefined};
    settle: (result: LinkSubscribe) => void = () => undefined;
    writes: LayerWriteResult[] = [];

    subscribe(onSnapshot: (snapshot: LayerSnapshot) => void, onEnd: (reason: string, retry: boolean) => void): Promise<LinkSubscribe> {
        this.subscriptions += 1;
        this.push = onSnapshot;
        this.end = onEnd;
        if (this.next !== null) return Promise.resolve(this.next);
        return new Promise((resolve) => {
            this.settle = resolve;
        });
    }

    write(): Promise<LayerWriteResult> {
        const result = this.writes.shift();
        if (result === undefined) throw new Error("没有准备写入结果");
        return Promise.resolve(result);
    }
}

function connection(): {readonly view: WindowConnection; set(state: WindowConnectionState): void} {
    let current: WindowConnectionState = "online";
    const listeners = new Set<(state: WindowConnectionState) => void>();
    return {
        view: {state: () => current, onChange: (listener) => (listeners.add(listener), () => void listeners.delete(listener))},
        set: (state) => {
            current = state;
            for (const listener of [...listeners]) listener(state);
        },
    };
}

function instanceWith(link: ScriptedLink, online?: WindowConnection) {
    const records: string[] = [];
    const instance = createSettingsInstance({
        layers: {user: link},
        declarations,
        clock: new ManualClock(),
        firstSnapshotMs: 3_000,
        ...(online === undefined ? {} : {connection: online}),
        record: (_level, event) => records.push(event),
    });
    return {instance, records, service: instance.facade(consumer).service};
}

describe("订阅的先后", () => {
    it("快照先于建立结果到达：照常应用，就绪", async () => {
        const link = new ScriptedLink();
        link.next = null;
        const {instance, service} = instanceWith(link);
        link.push(snapshot(1, {[theme.key]: "macos"}));
        await instance.ready;
        expect(service.get(theme)).toBe("macos");
        link.settle({ok: true, release: () => undefined});
    });

    it("订阅在建立结果返回之前就被结束：层不可用、就绪；建立结果随后返回时释放它；回到在线时重新订阅", async () => {
        const link = new ScriptedLink();
        link.next = null;
        const online = connection();
        const {instance, service} = instanceWith(link, online.view);
        link.end("disconnected", true);
        await instance.ready;
        expect(service.inspect(theme).user).toEqual({status: "unavailable"});
        let released = false;
        link.settle({ok: true, release: () => {
            released = true;
        }});
        await Promise.resolve();
        await Promise.resolve();
        expect(released).toBe(true);

        link.next = {ok: true, release: () => undefined};
        online.set("offline");
        online.set("online");
        expect(link.subscriptions).toBe(2);
        link.push(snapshot(1, {[theme.key]: "macos"}));
        expect(service.get(theme)).toBe("macos");
    });

    it("以终态原因结束（服务端已换进程）：回到在线也不重订", async () => {
        const link = new ScriptedLink();
        const online = connection();
        const {instance} = instanceWith(link, online.view);
        link.push(snapshot(1, {}));
        await instance.ready;
        link.end("server-restarted", false);
        online.set("offline");
        online.set("online");
        expect(link.subscriptions).toBe(1);
    });
});

describe("首个快照的截止", () => {
    it("按 Spec 输出 16 的 3 秒：2999 毫秒时仍在等，3000 毫秒时层不可用、就绪", async () => {
        const link = new ScriptedLink();
        link.next = null;
        const clock = new ManualClock();
        const instance = createSettingsInstance({layers: {user: link}, declarations, clock, firstSnapshotMs: FIRST_SNAPSHOT_MS, record: () => undefined});
        // 已就绪时 ready 的回调先排进队列，先于哨兵完成。
        const state = (): Promise<string> => Promise.race([instance.ready.then(() => "ready"), Promise.resolve().then(() => "waiting")]);
        clock.advance(2_999);
        expect(await state()).toBe("waiting");
        clock.advance(1);
        expect(await state()).toBe("ready");
        expect(instance.facade(consumer).service.inspect(theme).user).toEqual({status: "unavailable"});
    });
});

describe("读到自己的写入", () => {
    it("写入结果晚于更新的推送到达：不倒退；早于推送到达：update 返回时已是新值", async () => {
        const link = new ScriptedLink();
        const {instance, service} = instanceWith(link);
        link.push(snapshot(1, {[theme.key]: "a"}));
        await instance.ready;

        link.writes.push({ok: true, snapshot: snapshot(2, {[theme.key]: "b"})});
        link.push(snapshot(3, {[theme.key]: "c"}));
        expect(await service.update(theme, "b")).toEqual({ok: true});
        expect(service.get(theme)).toBe("c");

        link.writes.push({ok: true, snapshot: snapshot(4, {[theme.key]: "d"})});
        expect(await service.update(theme, "d")).toEqual({ok: true});
        expect(service.get(theme)).toBe("d");
    });
});

describe("变化通知", () => {
    it("只在有效值变化时调用，给出变了的键；层变坏而值不变时不调用但 inspect 变了；监听抛错不影响别的监听", async () => {
        const link = new ScriptedLink();
        const {instance, service, records} = instanceWith(link);
        link.push(snapshot(1, {}));
        await instance.ready;
        const seen: string[][] = [];
        service.onDidChange(() => {
            throw new Error("监听出错");
        });
        service.onDidChange((keys) => seen.push([...keys].sort()));

        link.push(snapshot(2, {[theme.key]: "macos", [size.key]: 12}));
        expect(seen).toEqual([[theme.key]]);
        link.push(snapshot(3, {[theme.key]: "macos", [size.key]: 12}, "invalid"));
        expect(seen).toEqual([[theme.key]]);
        expect(service.inspect(theme).user).toMatchObject({status: "invalid"});
        expect(records).toContain("settings.listener.failed");
    });

    it("两个调用方登记同一个函数：一方释放或取消，只撤掉自己的那一项", async () => {
        const link = new ScriptedLink();
        const {instance} = instanceWith(link);
        link.push(snapshot(1, {}));
        await instance.ready;
        const calls: string[] = [];
        const shared = (): void => {
            calls.push("shared");
        };
        const first = instance.facade(consumer);
        const second = instance.facade({...consumer, plugin: "x.other"});
        const cancel = first.service.onDidChange(shared);
        second.service.onDidChange(shared);
        link.push(snapshot(2, {[theme.key]: "a"}));
        expect(calls).toEqual(["shared", "shared"]);
        first.release();
        cancel();
        link.push(snapshot(3, {[theme.key]: "b"}));
        expect(calls).toEqual(["shared", "shared", "shared"]);
    });

    it("门面释放后监听不再调用（释放后的访问由内核的门面代理拒绝）", async () => {
        const link = new ScriptedLink();
        const {instance} = instanceWith(link);
        link.push(snapshot(1, {}));
        await instance.ready;
        const facade = instance.facade(consumer);
        const seen: number[] = [];
        facade.service.onDidChange(() => seen.push(1));
        facade.release();
        link.push(snapshot(2, {[theme.key]: "macos"}));
        expect(seen).toEqual([]);
    });
});
