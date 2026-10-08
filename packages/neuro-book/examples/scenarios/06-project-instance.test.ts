/**
 * 场景 6：项目级插件（`board` 的项目入口，窗口里的插件直接调用它的合同）。读法：先读 `plugins/board/`，再读这里。
 * 每个打开的项目一个实例（产品里是一个项目子进程），窗口按地址栏绑定其中一个；省略 `.at()` 到达的是窗口绑定的
 * 那个项目的那一代。行为合同：docs/specs/runtime/projects.md、plugin-channel.md。
 */

import {afterEach, expect, it} from "bun:test";

import type {RemoteRouter, RemoteUse} from "@notnotype/nb-runtime/remote";

import {boardContract} from "../plugins/board/shared/contracts";
import {boardBackendPlugin} from "../plugins/board/backend/plugin";
import {Stage} from "./hosts";
import {remoteProbe} from "./probes";

const stage = new Stage();

afterEach(async () => {
    for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
});

/** 起一个窗口，装上一个用白板的插件，交出它看到的白板客户端。 */
async function windowBoard(router: RemoteRouter, id: string, project?: string): Promise<RemoteUse<typeof boardContract>> {
    const user = remoteProbe("example.pinboard-ui", "browser");
    await stage.window(router, id, {plugins: [user.definition], project});
    return user.remote().use(boardContract);
}

it("场景 6：两个项目各有一块白板，窗口只看到自己绑定的那个项目的；没有绑定项目的窗口得到失败码", async () => {
    const {router} = await stage.server({plugins: []});
    await stage.project(router, "alpha", {plugins: [boardBackendPlugin]});
    await stage.project(router, "beta", {plugins: [boardBackendPlugin]});
    const alpha = await windowBoard(router, "window-a", "alpha");
    const beta = await windowBoard(router, "window-b", "beta");
    const unbound = await windowBoard(router, "window-c");

    expect(await alpha.pin({text: "alpha 的条目"})).toEqual({ok: true, value: null});
    expect(await beta.pin({text: "beta 的条目"})).toEqual({ok: true, value: null});
    expect(await alpha.items({})).toEqual({ok: true, value: ["alpha 的条目"]});
    expect(await beta.items({})).toEqual({ok: true, value: ["beta 的条目"]});
    expect(await unbound.items({})).toMatchObject({ok: false});
});

it("场景 6：项目实例结束时，窗口里的订阅随白板的项目入口停止而结束（provider-stopped），实例断开后调用得到 target-gone", async () => {
    const {router} = await stage.server({plugins: []});
    await stage.project(router, "alpha", {plugins: [boardBackendPlugin]});
    const alpha = await windowBoard(router, "window-a", "alpha");
    const seen: string[] = [];
    const ended = Promise.withResolvers<string>();
    expect(await alpha.events.pinned.subscribe({}, (text) => seen.push(text), {onEnd: ended.resolve})).toMatchObject({ok: true});
    await alpha.pin({text: "结束前"});

    expect(await stage.stopProject("alpha")).toEqual({status: "closed"});
    // 有序停止先停项目实例里的入口，订阅在链路断开之前就结束了。
    expect(await ended.promise).toBe("provider-stopped");
    expect(seen).toEqual(["结束前"]);
    expect(await alpha.items({})).toMatchObject({ok: false, code: "target-gone"});
});

it("场景 6：项目这一代结束后，绑定它的窗口重连得到终态 project-gone；上一代停完之前不能起下一代", async () => {
    const {router} = await stage.server({plugins: []});
    await stage.project(router, "alpha", {plugins: [boardBackendPlugin]});
    await windowBoard(router, "window-a", "alpha");
    await expect(stage.project(router, "alpha", {plugins: [boardBackendPlugin]})).rejects.toThrow("还没停止");

    expect(await stage.stopProject("alpha")).toEqual({status: "closed"});
    expect(await stage.reconnect(router, "window-a")).toMatchObject({ok: false, reason: "project-gone"});
});
