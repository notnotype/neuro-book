/**
 * 场景 2：按调用方提供服务（`notes`）。读法：先读 `plugins/notes/`，再读这里。
 * 行为合同：docs/specs/runtime/services.md 输出第 11–12 条。
 */

import {afterEach, expect, it} from "bun:test";

import {ServiceRevokedError} from "@notnotype/nb-runtime/services";

import {notesKey} from "../plugins/notes/shared/contracts";
import {notesBackendPlugin} from "../plugins/notes/backend/plugin";
import {Stage} from "./hosts";
import {serviceProbe} from "./probes";

const stage = new Stage();

afterEach(async () => {
    for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
});

it("场景 2：两个插件各拿到自己的门面，只看到自己写的笔记；实例停止后门面作废", async () => {
    const a = serviceProbe("example.a", "server", [notesKey]);
    const b = serviceProbe("example.b", "server", [notesKey]);
    await stage.local({plugins: [notesBackendPlugin, a.definition, b.definition]});

    a.get(notesKey).add("A 的笔记");
    b.get(notesKey).add("B 的笔记");
    expect(a.get(notesKey).list()).toEqual(["A 的笔记"]);
    expect(b.get(notesKey).list()).toEqual(["B 的笔记"]);

    await stage.close();
    expect(() => a.get(notesKey).list()).toThrow(ServiceRevokedError);
});
