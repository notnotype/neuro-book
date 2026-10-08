/**
 * 场景 4：跨实例的远程服务（`counter` 的服务端入口与浏览器入口）。读法：先读 `plugins/counter/`，再读这里。
 * 行为合同：docs/specs/runtime/plugin-channel.md。
 */

import {afterEach, expect, it} from "bun:test";

import {counterKey} from "../plugins/counter/shared/contracts";
import {counterBackendPlugin} from "../plugins/counter/backend/plugin";
import {counterBrowserPlugin} from "../plugins/counter/web/plugin";
import {Stage} from "./hosts";
import {serviceProbe} from "./probes";

const stage = new Stage();

afterEach(async () => {
    for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
});

it("场景 4：服务端入口在第一次远程调用时才激活；窗口里的插件经本地服务读写、订阅收到每次变化；不合合同的输入被拒", async () => {
    const {app: hub, router} = await stage.server({plugins: [counterBackendPlugin]});
    const panel = serviceProbe("example.panel", "browser", [counterKey]);
    await stage.window(router, "window-1", {plugins: [counterBrowserPlugin, panel.definition]});
    const counter = panel.get(counterKey);
    expect(hub.plugins.entryState({plugin: "example.counter", entry: "server"})?.status).toBe("registered");

    const seen: number[] = [];
    expect(await counter.watch((value) => seen.push(value))).toMatchObject({ok: true});
    expect(await counter.increment(2)).toEqual({ok: true, value: 2});
    expect(await counter.increment(3)).toEqual({ok: true, value: 5});
    expect(await counter.current()).toEqual({ok: true, value: 5});
    // 事件与结果走同一条链路、按发送顺序到达：拿到结果时之前的事件已经送达。
    expect(seen).toEqual([2, 5]);
    expect(hub.plugins.entryState({plugin: "example.counter", entry: "server"})?.status).toBe("available");

    expect(await counter.increment(0)).toMatchObject({ok: false, code: "invalid-input"});
});
