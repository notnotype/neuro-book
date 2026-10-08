/**
 * 场景 2：按调用方提供（`notes` 的服务端入口）。
 *
 * 要说明的事：
 * - 提供方的工厂对每个调用方各生成一个门面，参数是内核填写的调用方身份：两个插件调用同一份合同，各自只看到自己的
 *   笔记，接口上没有“我是谁”的参数可以冒充。
 * - 门面属于调用方入口的这一代：调用方停止后它手里的旧门面不能再用，数据却归提供方（存在 `nbook.storage`），同一个
 *   插件下一代拿到新门面，读到的还是原来的笔记。
 * - 数据在状态根下的 SQLite 里：服务端实例停掉再起，笔记还在。
 *
 * 阅读顺序：`plugins/notes/shared/contracts.ts` → `plugins/notes/backend/plugin.ts`（`provideRemote` 的工厂）→ 这里。
 *
 * 行为合同：docs/specs/runtime/services.md 输出第 11–12 条、docs/specs/runtime/plugin-channel.md 输出第 1–3 条、
 * docs/specs/storage/persistence.md。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {notesBackendPlugin} from "../plugins/notes/backend/plugin";
import {notesContract} from "../plugins/notes/shared/contracts";
import {remoteProbe} from "../testing/probes";
import {Stage} from "../testing/stage";

let tmp = "";
let cases = 0;
const stages: Stage[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-examples", "示例场景 2：按调用方提供");
});

afterEach(async () => {
    for (const stage of stages.splice(0)) {
        for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
    }
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function newStage(): Stage {
    cases += 1;
    const stage = new Stage(join(tmp, `case-${String(cases)}`));
    stages.push(stage);
    return stage;
}

describe("场景 2：按调用方提供", () => {
    it("两个插件调用同一份合同，各自只看到自己的笔记", async () => {
        const stage = newStage();
        const a = remoteProbe("example.a", "server");
        const b = remoteProbe("example.b", "server");
        await stage.server({plugins: [notesBackendPlugin, a.definition, b.definition]});

        await a.remote().use(notesContract).add({text: "A 的笔记"});
        await b.remote().use(notesContract).add({text: "B 的笔记"});

        expect(await a.remote().use(notesContract).list({})).toMatchObject({ok: true, value: [{text: "A 的笔记"}]});
        expect(await b.remote().use(notesContract).list({})).toMatchObject({ok: true, value: [{text: "B 的笔记"}]});
    });

    it("调用方停止后，它手里的旧门面不能再用；同一插件的下一代拿到新门面，读到原来的笔记；别的调用方不受影响", async () => {
        const stage = newStage();
        const b = remoteProbe("example.b", "server");
        const {app} = await stage.server({plugins: [notesBackendPlugin, b.definition]});
        // A 装在自己的子作用域里，`stop()` 停掉它（产品里对应停用插件）。
        const first = remoteProbe("example.a", "server");
        const attached = await stage.attach(app, first.definition, "server");
        const stale = first.remote().use(notesContract);
        expect(await stale.add({text: "A 停止前写的"})).toMatchObject({ok: true});

        expect((await attached.stop()).status).toBe("closed");
        // 调用方入口停止时，内核取消它发出的调用、释放提供方为它生成的门面。
        expect(await stale.list({})).toMatchObject({ok: false, code: "cancelled"});
        expect(await b.remote().use(notesContract).add({text: "B 照常"})).toMatchObject({ok: true});

        const second = remoteProbe("example.a", "server");
        await stage.attach(app, second.definition, "server");
        expect(await second.remote().use(notesContract).list({})).toMatchObject({ok: true, value: [{text: "A 停止前写的"}]});
    });

    it("服务端实例停掉再起，笔记还在：数据在状态根下的 SQLite 里，不在提供方的内存里", async () => {
        const stage = newStage();
        const before = remoteProbe("example.a", "server");
        await stage.server({plugins: [notesBackendPlugin, before.definition]});
        await before.remote().use(notesContract).add({text: "重启前写的"});
        for (const result of await stage.close()) expect(result).toEqual({status: "closed"});

        // 同一个场地、同一个状态根，起一个新的服务端实例。
        const after = remoteProbe("example.a", "server");
        await stage.server({plugins: [notesBackendPlugin, after.definition]});
        expect(await after.remote().use(notesContract).list({})).toMatchObject({ok: true, value: [{text: "重启前写的"}]});
    });
});
