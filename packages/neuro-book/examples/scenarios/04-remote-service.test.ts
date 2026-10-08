/**
 * 场景 4：跨实例的远程服务（`counter` 的服务端入口，窗口里的面板插件直接调用它的合同）。读法：先读
 * `plugins/counter/`，再读这里。行为合同：docs/specs/runtime/plugin-channel.md。
 */

import {afterEach, expect, it} from "bun:test";

import {orThrow, RemoteCallError} from "@notnotype/nb-runtime/remote";

import {counterContract} from "../plugins/counter/shared/contracts";
import {counterBackendPlugin} from "../plugins/counter/backend/plugin";
import {Stage} from "./hosts";
import {remoteProbe} from "../testing/probes";

const stage = new Stage();

afterEach(async () => {
    for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
});

it("场景 4：服务端入口在第一次远程调用时才激活；面板直接用合同读写、订阅收到每次变化，提供方看到的调用方是面板本身；不合合同的输入被拒", async () => {
    const {app: hub, router} = await stage.server({plugins: [counterBackendPlugin]});
    const panel = remoteProbe("example.panel", "browser");
    await stage.window(router, "window-1", {plugins: [panel.definition]});
    // 提供方位置是 server，省略 `.at()` 即到服务端。
    const counter = panel.remote().use(counterContract);
    expect(hub.plugins.entryState({plugin: "example.counter", entry: "server"})?.status).toBe("registered");

    const seen: number[] = [];
    expect(await counter.events.changed.subscribe({}, (value) => seen.push(value))).toMatchObject({ok: true});
    expect(await counter.increment({by: 2})).toEqual({ok: true, value: 2});
    // 只想要值时用 orThrow：成功给值，失败抛 RemoteCallError。
    expect(orThrow(await counter.increment({by: 3}))).toBe(5);
    expect(await counter.current({})).toEqual({ok: true, value: 5});
    // 事件与结果走同一条链路、按发送顺序到达：拿到结果时之前的事件已经送达。
    expect(seen).toEqual([2, 5]);
    expect(hub.plugins.entryState({plugin: "example.counter", entry: "server"})?.status).toBe("available");
    expect(await counter.caller({})).toEqual({ok: true, value: {plugin: "example.panel", instance: "window-1"}});

    const rejected = await counter.increment({by: 0});
    expect(rejected).toMatchObject({ok: false, code: "invalid-input"});
    expect(() => orThrow(rejected)).toThrow(RemoteCallError);
});

it("场景 4：订阅归发起它的入口——面板插件停止后它的订阅随之结束，之后的变化不再送到它；别的插件照常收到", async () => {
    const {router} = await stage.server({plugins: [counterBackendPlugin]});
    const writer = remoteProbe("example.writer", "browser");
    const window = await stage.window(router, "window-1", {plugins: [writer.definition]});
    const counter = writer.remote().use(counterContract);

    // 面板插件装在窗口的一个子作用域里，关掉这个作用域就停止了它的入口（产品里对应卸载或停用插件）。
    const panel = remoteProbe("example.panel", "browser");
    const panelScope = window.root.createChild("panel");
    panelScope.open();
    expect(window.plugins.register(panel.definition, {scope: panelScope})).toMatchObject({status: "accepted"});
    expect(await window.plugins.activate({plugin: "example.panel", entry: "browser"})).toMatchObject({status: "activated"});
    const panelSeen: number[] = [];
    const writerSeen: number[] = [];
    expect(await panel.remote().use(counterContract).events.changed.subscribe({}, (value) => panelSeen.push(value))).toMatchObject({ok: true});
    expect(await counter.events.changed.subscribe({}, (value) => writerSeen.push(value))).toMatchObject({ok: true});
    await counter.increment({by: 1});

    expect((await panelScope.close()).status).toBe("closed");
    await counter.increment({by: 1});
    // 内核在面板入口停止时替它结束订阅，面板不用自己记着释放；完整的取消条件见 src/remote/routing.test.ts 的订阅各组。
    expect(panelSeen).toEqual([1]);
    expect(writerSeen).toEqual([1, 2]);
});
