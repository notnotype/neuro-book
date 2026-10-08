/**
 * 场景 5：以调用方身份代理（`notes` 的浏览器入口转发到服务端入口）。
 *
 * 要说明的事：
 * - 窗口里的两个插件经 notes 的浏览器入口读写，服务端看到的调用方是窗口里的原插件、`via` 是代理：两个插件各写各的，
 *   同一个插件在服务端直接写、在窗口里经代理写，落在同一份列表里。
 * - 浏览器入口在合同之上加了一份同步可读的缓存，它随服务端的 `changed` 更新，不管修改来自哪个实例。
 * - 以调用方身份代理是受控的能力：插件不在宿主的代理允许清单里，调用与订阅都得到 `denied`，请求不发出。
 *
 * 阅读顺序：`plugins/notes/shared/contracts.ts` → `plugins/notes/backend/plugin.ts` → `plugins/notes/web/plugin.ts` →
 * 这里。产品里的同款结构是 `nbook.storage` 的浏览器入口（`src/plugins/storage/web/plugin.ts`）。
 *
 * 行为合同：docs/specs/runtime/services.md 输出第 13 条、docs/specs/runtime/plugin-channel.md 输出第 7、10 条、
 * docs/specs/runtime/plugins.md 输出第 20 条。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {clockBackendPlugin} from "../plugins/clock/backend/plugin";
import {notesBackendPlugin} from "../plugins/notes/backend/plugin";
import {notesContract, notesViewKey} from "../plugins/notes/shared/contracts";
import {notesBrowserPlugin} from "../plugins/notes/web/plugin";
import {remoteProbe, serviceProbe} from "../testing/probes";
import {Stage} from "../testing/stage";

let tmp = "";
let cases = 0;
const stages: Stage[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-examples", "示例场景 5：以调用方身份代理");
});

afterEach(async () => {
    for (const stage of stages.splice(0)) {
        for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
    }
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/**
 * 服务端装 clock 与 notes，另有一个服务端插件 `example.a`（与窗口里的 `example.a` 同一个插件的服务端入口）；窗口里
 * 装 notes 的浏览器入口与两个用笔记视图的插件。`delegation` 是宿主给的代理允许清单里另加的插件。
 */
async function windowWith(delegation: ReadonlyArray<string>) {
    cases += 1;
    const stage = new Stage(join(tmp, `case-${String(cases)}`));
    stages.push(stage);
    const serverA = remoteProbe("example.a", "server");
    const {router} = await stage.server({plugins: [clockBackendPlugin, notesBackendPlugin, serverA.definition]});
    const a = serviceProbe("example.a", "browser", [notesViewKey]);
    const b = serviceProbe("example.b", "browser", [notesViewKey]);
    await stage.window(router, "window-1", {plugins: [notesBrowserPlugin, a.definition, b.definition], delegation});
    return {stage, a: a.get(notesViewKey), b: b.get(notesViewKey), serverA: serverA.remote().use(notesContract)};
}

describe("场景 5：以调用方身份代理", () => {
    it("代理在允许清单里：两个插件经代理各写各的；服务端看到的调用方是原插件，via 是 example.notes", async () => {
        const {a, b, serverA} = await windowWith(["example.notes"]);
        expect(await a.sync()).toEqual({ok: true, value: null});
        expect(await b.sync()).toEqual({ok: true, value: null});
        expect(a.notes()).toEqual([]);

        const added = await a.add("A 在窗口里写的");
        expect(added).toEqual({ok: true, value: {text: "A 在窗口里写的", writtenAt: 0, via: "example.notes"}});
        // 事件与结果走同一条链路、按发送顺序到达：拿到 add 的结果时，服务端推来的新列表已经进了缓存。
        expect(a.notes()).toEqual([{text: "A 在窗口里写的", writtenAt: 0, via: "example.notes"}]);
        expect(b.notes()).toEqual([]);
        // 服务端的 example.a 直接读：同一个插件，同一份笔记。
        expect(await serverA.list({})).toMatchObject({ok: true, value: [{text: "A 在窗口里写的", via: "example.notes"}]});
    });

    it("同步缓存随服务端的 changed 更新：服务端的 example.a 直接写，窗口里 A 的缓存跟着变，B 的不变", async () => {
        const {stage, a, b, serverA} = await windowWith(["example.notes"]);
        await a.sync();
        await b.sync();

        stage.clock.advance(1000);
        expect(await serverA.add({text: "A 在服务端写的"})).toMatchObject({ok: true});
        // 这条修改来自服务端，事件经另一条链路送到窗口，到达时刻与上面的结果无关，所以等缓存出现它。
        expect(await waitUntil("窗口里 A 的缓存出现服务端写的笔记", () => a.notes()?.length === 1 && a.notes())).toEqual([{text: "A 在服务端写的", writtenAt: 1000, via: null}]);
        expect(b.notes()).toEqual([]);
    });

    it("代理不在允许清单里：以调用方身份的调用与订阅都得到 denied，请求不发出", async () => {
        const {a, serverA} = await windowWith([]);

        expect(await a.add("写不进去")).toMatchObject({ok: false, code: "denied"});
        expect(await a.sync()).toMatchObject({ok: false, code: "denied"});
        expect(a.notes()).toBeNull();
        expect(await serverA.list({})).toEqual({ok: true, value: []});
    });
});
