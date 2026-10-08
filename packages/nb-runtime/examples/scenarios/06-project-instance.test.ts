/**
 * 场景 6：项目级插件（`board` 的项目入口与浏览器入口）。读法：先读 `plugins/board/`，再读这里。
 * 每个打开的项目一个实例（产品里是一个项目子进程），窗口按地址栏绑定其中一个；`.at("project")` 到达的是窗口绑定的
 * 那个项目的那一代。行为合同：docs/specs/runtime/projects.md、plugin-channel.md。
 */

import {afterEach, expect, it} from "bun:test";

import type {RemoteRouter} from "@notnotype/nb-runtime/remote";

import {boardKey} from "../plugins/board/shared/contracts";
import type {BoardService} from "../plugins/board/shared/contracts";
import {createBoardProjectPlugin} from "../plugins/board/backend/plugin";
import {createBoardBrowserPlugin} from "../plugins/board/web/plugin";
import {Stage} from "./hosts";
import {serviceProbe} from "./probes";

const stage = new Stage();

afterEach(async () => {
    for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
});

/** 起一个窗口，装上白板的浏览器入口与一个用它的探针，交出白板服务。 */
async function windowBoard(router: RemoteRouter, id: string, project?: string): Promise<BoardService> {
    const user = serviceProbe("example.pinboard-ui", "browser", [boardKey]);
    await stage.window(router, id, {plugins: [createBoardBrowserPlugin(), user.definition], project});
    return user.get(boardKey);
}

it("场景 6：两个项目各有一块白板，窗口只看到自己绑定的那个项目的；没有绑定项目的窗口得到失败码", async () => {
    const {router} = await stage.server({plugins: []});
    await stage.project(router, "alpha", {plugins: [createBoardProjectPlugin()]});
    await stage.project(router, "beta", {plugins: [createBoardProjectPlugin()]});
    const alpha = await windowBoard(router, "window-a", "alpha");
    const beta = await windowBoard(router, "window-b", "beta");
    const unbound = await windowBoard(router, "window-c");

    expect(await alpha.pin("alpha 的条目")).toEqual({ok: true, value: null});
    expect(await beta.pin("beta 的条目")).toEqual({ok: true, value: null});
    expect(await alpha.items()).toEqual({ok: true, value: ["alpha 的条目"]});
    expect(await beta.items()).toEqual({ok: true, value: ["beta 的条目"]});
    expect(await unbound.items()).toMatchObject({ok: false});
});

it("场景 6：项目实例结束时，窗口里的订阅随白板的项目入口停止而结束（provider-stopped），实例断开后调用得到 target-gone", async () => {
    const {router} = await stage.server({plugins: []});
    await stage.project(router, "alpha", {plugins: [createBoardProjectPlugin()]});
    const alpha = await windowBoard(router, "window-a", "alpha");
    const seen: string[] = [];
    const ended = Promise.withResolvers<string>();
    expect(await alpha.watch((text) => seen.push(text), {onEnd: ended.resolve})).toMatchObject({ok: true});
    await alpha.pin("结束前");

    expect(await stage.stopProject("alpha")).toEqual({status: "closed"});
    // 有序停止先停项目实例里的入口，订阅在链路断开之前就结束了。
    expect(await ended.promise).toBe("provider-stopped");
    expect(seen).toEqual(["结束前"]);
    expect(await alpha.items()).toMatchObject({ok: false, code: "target-gone"});
});
