/**
 * 欢迎页的新建章节（docs/specs/workbench/bookshelf.md 输出 19）：内存文件适配器（与真实 Files 对过契约，
 * `plugins/explorer/memory-files.test.ts`）加真实内核的命令服务。按已有名字避让、以正式标签打开；编辑器的打开命令不在时，
 * 文件照样建好，原因写出来。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";

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
import {createMemoryFiles} from "nbook/plugins/explorer/web/lab/memory-files";
import {standaloneSettings} from "nbook/plugins/settings/testing/standalone";
import {statePlugin} from "nbook/plugins/state/shared/plugin";
import type {DisplayLocale} from "nbook/shared/localized-text";
import {textIn} from "nbook/shared/testing/text";

import {createChapter} from "./web/welcome";
import {projectsCatalogs} from "./web/text";

/** 用 `nbook.projects` 的目录解析成某种语言的文字（窗口里这是翻译端口的事）。 */
const projectsTextIn = (locale: DisplayLocale) => textIn(locale, {"nbook.projects": projectsCatalogs.catalogs});

const silent = {error: () => undefined};
let tmp = "";
const started: Application[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-projects", "welcome-chapter");
});

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 登记 `nbook.editor.open` 并记下收到的参数；不装这个插件就是编辑器不在。 */
function editorOf(calls: unknown[]): PluginDefinition {
    return {
        id: "nbook.chapter-example",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            contributions: [{capability: COMMANDS_POINT, id: "nbook.editor.open", declaration: {title: {"zh-CN": "打开", "en-US": "Open"}, description: "open", args: Type.Object({address: Type.String(), mode: Type.String()}, {additionalProperties: false}), effect: "read"}}],
            activate: () => ({contributions: {[COMMANDS_POINT]: {"nbook.editor.open": {run: (args: unknown) => {
                calls.push(args);
                return {ok: true as const, value: null};
            }}}}}),
        }],
    };
}

async function start(plugins: ReadonlyArray<PluginDefinition>): Promise<CommandService> {
    const identity = {location: "browser", instanceId: "welcome-chapter"};
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
        {capabilities: settings.capabilities, plugins: [diagnostics, statePlugin, ...settings.plugins, commandsPlugin, ...plugins, consumer], requiredPlugins: [diagnostics.id, commandsPlugin.id], gates: []},
    );
    started.push(application);
    expect((await application.startup).status).toBe("available");
    if (found.current === null) throw new Error("没有拿到命令服务");
    return found.current;
}

const names = async (memory: ReturnType<typeof createMemoryFiles>): Promise<string[]> => {
    const listing = await memory.files.list("project://");
    return listing.ok ? listing.value.entries.map((entry) => entry.name).sort() : [];
};

describe("欢迎页的新建章节（bookshelf.md 输出 19）", () => {
    it("在项目根建“新章节.md”并以正式标签打开；已有时是“新章节 2.md”；英文界面是“New Chapter.md”", async () => {
        const calls: unknown[] = [];
        const commands = await start([editorOf(calls)]);
        const memory = createMemoryFiles({project: ["大纲.md"], user: []});
        expect(await createChapter(memory.files, commands, projectsTextIn("zh-CN"))).toBeNull();
        expect(await createChapter(memory.files, commands, projectsTextIn("zh-CN"))).toBeNull();
        expect(await createChapter(memory.files, commands, projectsTextIn("en-US"))).toBeNull();
        expect(await names(memory)).toEqual(["New Chapter.md", "大纲.md", "新章节 2.md", "新章节.md"].sort());
        expect(calls).toEqual([
            {address: "project://新章节.md", mode: "permanent"},
            {address: "project://新章节 2.md", mode: "permanent"},
            {address: "project://New Chapter.md", mode: "permanent"},
        ]);
    });

    it("编辑器的打开命令不在：文件照样建好，返回“建好了……但打不开”与原因", async () => {
        const commands = await start([]);
        const memory = createMemoryFiles({project: [], user: []});
        expect(await createChapter(memory.files, commands, projectsTextIn("zh-CN"))).toMatch(/^建好了 新章节\.md，但打不开：.+/u);
        expect(await names(memory)).toEqual(["新章节.md"]);
    });
});
