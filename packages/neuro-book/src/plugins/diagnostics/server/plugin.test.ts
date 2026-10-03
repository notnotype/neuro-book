/**
 * 后端诊断入口的 console 桥接：激活期间 `console.warn`、`console.error` 照常输出并记入诊断，
 * 服务释放后恢复为激活前的函数。经内核真实激活与关闭，不直接调用入口内部函数。
 */

import {afterEach, expect, it} from "bun:test";
import {rm} from "node:fs/promises";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createApplication} from "@notnotype/nb-runtime/application";
import {createDiagnosticsStore, diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";

import {createServerDiagnosticsPlugin} from "./plugin";

const original = {warn: console.warn, error: console.error};
let root = "";

afterEach(async () => {
    console.warn = original.warn;
    console.error = original.error;
    if (root !== "") await rm(root, {recursive: true, force: true});
});

it("激活期间 console.warn/error 照常输出并记入诊断，关闭后恢复激活前的函数", async () => {
    root = await createTestTmpRoot("nbook-diagnostics", "console-bridge");
    const printed: unknown[][] = [];
    const recordWarn = (...args: unknown[]): void => {
        printed.push(["warn", ...args]);
    };
    const recordError = (...args: unknown[]): void => {
        printed.push(["error", ...args]);
    };
    console.warn = recordWarn;
    console.error = recordError;

    const store = createDiagnosticsStore({identity: {location: "server", instanceId: "console-bridge"}});
    const plugin = createServerDiagnosticsPlugin({store, exporter: {directory: root}});
    const application = createApplication(
        {identity: {location: "server", instanceId: "console-bridge"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {keys: [diagnosticsKey], plugins: [plugin], requiredPlugins: [plugin.id], gates: []},
    );
    expect((await application.startup).status).toBe("available");
    expect(console.error).not.toBe(recordError);

    const failure = new Error("桥接的错误");
    console.error("出错了", failure);
    console.warn("注意");
    expect(printed).toEqual([["error", "出错了", failure], ["warn", "注意"]]);
    const bridged = store.query({plugin: plugin.id}).records.filter((record) => record.event.startsWith("console."));
    expect(bridged.map((record) => [record.level, record.event, record.message])).toEqual([
        ["error", "console.error", "出错了 桥接的错误"],
        ["warn", "console.warn", "注意"],
    ]);

    expect((await application.stop()).status).toBe("closed");
    expect(console.error).toBe(recordError);
    expect(console.warn).toBe(recordWarn);
});
