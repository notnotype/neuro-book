/**
 * 空编辑组的提示（docs/specs/workbench/editor.md 输出 32）：真实内核的浏览器实例装上命令系统与公开状态，测试插件登记
 * 提示引用的三条命令。命令不存在或不可用（`when` 不满足）时那一行不出现；有快捷键的写出按键（mac 是一串符号），没有的
 * 写出位置；文字跟着界面语言。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";

import {ref} from "@vue/reactivity";
import {Type} from "typebox";

import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createApplication} from "nbook/application";
import {COMMANDS_POINT, commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import {commandsPlugin} from "nbook/plugins/commands/shared/plugin";
import {standaloneSettings} from "nbook/plugins/settings/testing/standalone";
import {PUBLIC_STATE_POINT} from "nbook/plugins/state/shared/contracts";
import {statePlugin} from "nbook/plugins/state/shared/plugin";

import {testTextPort} from "nbook/shared/testing/text-port";

import {emptyTips} from "./web/empty-tips";
import {editorCatalogs} from "./web/text";

const zh = testTextPort("zh-CN", {"nbook.editor": editorCatalogs});
const en = testTextPort("en-US", {"nbook.editor": editorCatalogs});
const silent = {error: () => undefined};
let tmp = "";
const started: Application[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-editor", "empty-tips");
});

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 登记提示引用的命令（`welcome` 为 false 时不登记欢迎页命令）；新建文件的 `when` 读公开键 `canCreate`。 */
function commandsOf(canCreate: ReturnType<typeof ref<boolean>>, welcome: boolean): PluginDefinition {
    const run = {run: () => ({ok: true as const, value: null})};
    const declaration = (title: string, extra: Record<string, unknown> = {}) => ({
        title: {"zh-CN": title, "en-US": title},
        description: title,
        args: Type.Object({}, {additionalProperties: false}),
        effect: "read" as const,
        ...extra,
    });
    const ids = ["nbook.quick-open.open-commands", "nbook.files.new-file", ...(welcome ? ["nbook.help.welcome"] : [])];
    return {
        id: "nbook.tips-example",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            contributions: [
                {capability: PUBLIC_STATE_POINT, id: "nbook.tips-example/canCreate", declaration: {type: "boolean", unready: false, reason: {"zh-CN": "没有可以新建的位置", "en-US": "Nowhere to create"}}},
                {capability: COMMANDS_POINT, id: "nbook.quick-open.open-commands", declaration: declaration("命令面板", {keybinding: "Mod+Shift+P"})},
                {capability: COMMANDS_POINT, id: "nbook.files.new-file", declaration: declaration("新建文件", {when: {requires: ["nbook.tips-example/canCreate"]}})},
                ...(welcome ? [{capability: COMMANDS_POINT, id: "nbook.help.welcome", declaration: declaration("欢迎")}] : []),
            ],
            activate: () => ({contributions: {
                [PUBLIC_STATE_POINT]: {"nbook.tips-example/canCreate": {kind: "bound", read: () => canCreate.value}},
                [COMMANDS_POINT]: Object.fromEntries(ids.map((id) => [id, run])),
            }}),
        }],
    };
}

async function start(plugin: PluginDefinition): Promise<CommandService> {
    const identity = {location: "browser", instanceId: "empty-tips"};
    const store = createDiagnosticsStore({identity});
    const diagnostics = createDiagnosticsPlugin({location: "browser", store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    const settings = standaloneSettings("browser", tmp);
    const found: {current: CommandService | null} = {current: null};
    const consumer: PluginDefinition = {
        id: "example.consumer",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: commandServiceKey}],
            activate: (context) => {
                found.current = context.services.require(commandServiceKey);
                return {};
            },
        }],
    };
    const application = createApplication(
        {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
        {capabilities: settings.capabilities, plugins: [diagnostics, statePlugin, ...settings.plugins, commandsPlugin, plugin, consumer], requiredPlugins: [diagnostics.id, commandsPlugin.id], gates: []},
    );
    started.push(application);
    expect((await application.startup).status).toBe("available");
    if (found.current === null) throw new Error("没有拿到命令服务");
    return found.current;
}

describe("空编辑组的提示（editor.md 输出 32）", () => {
    it("三行：命令面板写按键，新建文件与欢迎页写位置；不可用的那一行不出现；mac 的按键是一串符号；英文界面换文字", async () => {
        const canCreate = ref(true);
        const commands = await start(commandsOf(canCreate, true));
        expect(emptyTips(commands, zh, "other")).toEqual([
            {command: "nbook.quick-open.open-commands", label: "显示所有命令", keys: ["Ctrl", "Shift", "P"], hint: null},
            {command: "nbook.files.new-file", label: "新建文件", keys: null, hint: "资源管理器标题行的“新建文件”"},
            {command: "nbook.help.welcome", label: "打开欢迎页", keys: null, hint: "帮助 › 欢迎"},
        ]);
        canCreate.value = false;
        expect(emptyTips(commands, zh, "other").map((tip) => tip.command)).toEqual(["nbook.quick-open.open-commands", "nbook.help.welcome"]);
        expect(emptyTips(commands, en, "mac")[0]).toEqual({command: "nbook.quick-open.open-commands", label: "Show All Commands", keys: ["⇧⌘P"], hint: null});
    });

    it("命令不存在时那一行不出现", async () => {
        const commands = await start(commandsOf(ref(true), false));
        expect(emptyTips(commands, zh, "other").map((tip) => tip.command)).toEqual(["nbook.quick-open.open-commands", "nbook.files.new-file"]);
    });
});
