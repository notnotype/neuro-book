/**
 * 状态栏“待处理 N”与公开状态 `nbook.canon/hasPending`（pending-count.ts、plugin.ts；docs/specs/canon/author-ui.md 输出 25）接在
 * 进程内的真实世界上：canon 的浏览器入口把状态栏条目交给工作台的贡献点，测试插件（`testing/page-stand-in.ts`）收下它；公开状态
 * 经真实的公开状态插件读。数据经另一个窗口发布。
 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, it} from "vitest";

import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {publicStateKey} from "nbook/plugins/state/shared/contracts";
import type {PublicStateService} from "nbook/plugins/state/shared/contracts";
import {statePlugin} from "nbook/plugins/state/shared/plugin";
import {testTextPort} from "nbook/shared/testing/text-port";

import {canonNodeWorld} from "../testing/node-world";
import type {CanonNodeWorld} from "../testing/node-world";
import {pageStandIn} from "../testing/page-stand-in";
import {check, person, publish, publishWith} from "../testing/world-fixtures";
import {PENDING_COUNT_ITEM} from "./plugin";
import {canonCatalogs} from "./text";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});

let tmp: string;
let venue: CanonNodeWorld | null = null;

beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "pending-count");
    await mkdir(join(tmp, "Book", "manuscripts.binder"), {recursive: true});
    await writeFile(join(tmp, "Book", "manuscripts.binder", "binder.xml"), '<binder nextId="2"><chapter id="1" title="入学"/></binder>');
});

afterEach(async () => {
    await venue?.close();
    venue = null;
    await rm(tmp, {recursive: true, force: true});
});

const silent = {error: () => undefined};

/** 窗口里的公开状态服务：一个只取服务的测试插件。 */
function stateReader(): {readonly plugin: PluginDefinition; readonly read: (key: string) => unknown} {
    let service: PublicStateService | null = null;
    return {
        plugin: {id: "test.state-reader", entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], dependencies: [{key: publicStateKey}], activate: (context) => {
            service = context.services.require(publicStateKey);
            return {};
        }}]},
        read: (key) => {
            const read = service!.read(key);
            return read.status === "undeclared" ? undefined : read.value;
        },
    };
}

describe("状态栏的待处理条数", () => {
    it("有待处理时公开状态为真、条目写“待处理 N”、警告状态，点了执行 show-pending；处理掉以后为假", async () => {
        venue = await canonNodeWorld(tmp);
        const standIn = pageStandIn();
        const state = stateReader();
        const diagnostics = createDiagnosticsPlugin({location: "browser", store: createDiagnosticsStore({identity: {location: "browser", instanceId: "mine"}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
        await venue.window("mine", [diagnostics, statePlugin, standIn.plugin, state.plugin]);
        const other = await venue.window("other");
        const item = standIn.statusItem(PENDING_COUNT_ITEM);
        expect(item.declaration.alignment).toBe("left");
        expect(item.declaration.command).toEqual({id: "nbook.canon.show-pending"});
        expect(item.declaration.when).toEqual({requires: ["nbook.canon/hasPending"]});

        await waitUntil("世界读到了", () => state.read("nbook.canon/hasPending") === false);

        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        // 正文写 500，算出来是 1000：一条核对点不符。
        const written = await publishWith(other.canon, [check(id, "1", 500)]);
        await waitUntil("有一条待处理", () => state.read("nbook.canon/hasPending") === true);
        expect(port.t(item.implementation.text())).toBe("待处理 1");
        expect(item.implementation.state?.()).toBe("warning");

        // 把核对点改成对得上的数：这一条消失。
        const checkId = written.ids[Object.keys(written.ids)[0]!]!;
        const stored = await other.canon.call("object", {ref: {kind: "check", id: checkId}});
        if (!stored.ok) throw new Error(JSON.stringify(stored.failure));
        await publish(other.canon, [{ref: {kind: "check", id: checkId}, after: {...(stored.value.object as object), value: 1000}}]);
        await waitUntil("没有待处理了", () => state.read("nbook.canon/hasPending") === false);
    });
});
