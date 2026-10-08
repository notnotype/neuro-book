/**
 * 场景 5：以调用方身份代理（`cloud-notes` 的浏览器入口转发到服务端入口）。读法：先读 `plugins/cloud-notes/`，
 * 再读这里。行为合同：docs/specs/runtime/services.md 输出第 13 条、plugin-channel.md 输出第 10 条。
 */

import {afterEach, expect, it} from "bun:test";

import {cloudNotesKey} from "../plugins/cloud-notes/shared/contracts";
import {createCloudNotesServerPlugin} from "../plugins/cloud-notes/server/plugin";
import {createCloudNotesBrowserPlugin} from "../plugins/cloud-notes/web/plugin";
import {Stage} from "./hosts";
import {serviceProbe} from "./probes";

const stage = new Stage();

afterEach(async () => {
    for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
});

async function windowWith(delegation: (plugin: string) => boolean) {
    const {router} = await stage.server({plugins: [createCloudNotesServerPlugin()]});
    const a = serviceProbe("example.a", "browser", [cloudNotesKey]);
    const b = serviceProbe("example.b", "browser", [cloudNotesKey]);
    await stage.window(router, "window-1", {plugins: [createCloudNotesBrowserPlugin(), a.definition, b.definition], delegation});
    return {a: a.get(cloudNotesKey), b: b.get(cloudNotesKey)};
}

it("场景 5：代理在允许清单里：服务端按原调用方插件分开存，两个插件互不可见", async () => {
    const {a, b} = await windowWith((plugin) => plugin === "example.cloud-notes");

    expect(await a.add("A 的笔记")).toEqual({ok: true, value: null});
    expect(await b.add("B 的笔记")).toEqual({ok: true, value: null});
    expect(await a.list()).toEqual({ok: true, value: ["A 的笔记"]});
    expect(await b.list()).toEqual({ok: true, value: ["B 的笔记"]});
});

it("场景 5：代理不在允许清单里：以调用方身份转发得到 denied，不发出请求", async () => {
    const {a} = await windowWith(() => false);

    expect(await a.add("A 的笔记")).toMatchObject({ok: false, code: "denied"});
});
