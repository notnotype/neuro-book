/**
 * 编辑器的登记与交付（docs/specs/workbench/editor.md 输出 36–40）：真实内核的浏览器实例，拥有者插件用产品的贡献点校验与
 * `EditorRegistry`，贡献方与产品插件同样声明编辑器、交付实现。选择只看声明；组件的三种状态随交付与停止变化。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";

import {defineComponent} from "vue";

import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createApplication} from "nbook/application";

import {CODE_EDITOR, EDITOR_EDITORS_POINT, validateEditorContribution} from "./shared/contracts";
import type {EditorDeclaration} from "./shared/contracts";
import {EditorRegistry} from "./web/editor-registry";
import {resolveEditor} from "./web/editors";

const silent = {error: () => undefined};
let tmp = "";
const started: Application[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-editor", "editor-registry");
});

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const Builtin = defineComponent({name: "BuiltinCode", render: () => null});
const Viewer = defineComponent({name: "TestViewer", render: () => null});

const VIEWER: EditorDeclaration = {title: {"zh-CN": "查看器", "en-US": "Viewer"}, selector: {extensions: ["png"]}, priority: "default", input: "bytes"};

function owner(holder: {registry: EditorRegistry | null}): PluginDefinition {
    return {
        id: "test.owner",
        contributionPoints: [{id: EDITOR_EDITORS_POINT, implementation: "required", validate: validateEditorContribution}],
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            receives: [EDITOR_EDITORS_POINT],
            activate: (context) => {
                const registry = new EditorRegistry(context.declarations, {[CODE_EDITOR]: Builtin});
                holder.registry = registry;
                return {receivers: {[EDITOR_EDITORS_POINT]: registry.receiver()}};
            },
        }],
    };
}

/** 贡献方：不启动即激活，测试按需激活它，交付的时机由测试决定。 */
function viewer(holder: {context: ActivationContext | null}): PluginDefinition {
    return {
        id: "test.viewer",
        entries: [{
            id: "browser",
            location: "browser",
            contributions: [{capability: EDITOR_EDITORS_POINT, id: "test.viewer.image", declaration: VIEWER}],
            activate: (context) => {
                holder.context = context;
                return {contributions: {[EDITOR_EDITORS_POINT]: {"test.viewer.image": {load: async () => Viewer}}}};
            },
        }],
    };
}

/** 另一个贡献点的拥有者：它的接收方在暂存时拒绝，让投给它的贡献方激活失败。 */
const TRAP_POINT = "test.trap";
const trap: PluginDefinition = {
    id: "test.trap",
    contributionPoints: [{id: TRAP_POINT, implementation: "required"}],
    entries: [{
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        receives: [TRAP_POINT],
        activate: () => ({receivers: {[TRAP_POINT]: {prepare: () => {
            throw new Error("拒绝暂存");
        }}}}),
    }],
};

/** 贡献方：同时投给编辑器与 `test.trap`，后者暂存失败，编辑器的暂存项随之撤回、从没发布。 */
const brokenViewer: PluginDefinition = {
    id: "test.broken",
    entries: [{
        id: "browser",
        location: "browser",
        contributions: [
            {capability: EDITOR_EDITORS_POINT, id: "test.broken.image", declaration: VIEWER},
            {capability: TRAP_POINT, id: "test.broken.trap", declaration: {}},
        ],
        activate: () => ({contributions: {[EDITOR_EDITORS_POINT]: {"test.broken.image": {load: async () => Viewer}}, [TRAP_POINT]: {"test.broken.trap": {}}}}),
    }],
};

async function start(plugins: ReadonlyArray<PluginDefinition>, holder: {registry: EditorRegistry | null}): Promise<Application> {
    const identity = {location: "browser" as const, instanceId: "editor-registry"};
    const store = createDiagnosticsStore({identity});
    const diagnostics = createDiagnosticsPlugin({location: "browser", store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    const application = createApplication(
        {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
        {capabilities: [], plugins: [diagnostics, owner(holder), ...plugins], requiredPlugins: [diagnostics.id, "test.owner"], gates: []},
    );
    started.push(application);
    await application.startup;
    return application;
}

describe("Spec workbench.editor 输出 36–40：编辑器的登记与交付", () => {
    it("选择只看声明：贡献方还没激活时 png 已选它的编辑器、状态为未交付；激活后就绪；停止后为不在了，不回落到未交付", async () => {
        const holder: {registry: EditorRegistry | null} = {registry: null};
        const contributor: {context: ActivationContext | null} = {context: null};
        const application = await start([viewer(contributor)], holder);
        const registry = holder.registry!;
        expect(resolveEditor(registry.catalog, "project://a.png")).toEqual({kind: "editor", editor: "test.viewer.image"});
        expect(registry.state("test.viewer.image").kind).toBe("pending");
        expect(registry.state(CODE_EDITOR)).toEqual({kind: "ready", component: Builtin});
        expect(registry.state("test.missing.editor").kind).toBe("gone");

        expect(await application.plugins.activate({plugin: "test.viewer", entry: "browser"})).toMatchObject({status: "activated"});
        const ready = registry.state("test.viewer.image");
        expect(ready.kind).toBe("ready");
        // 同一次交付反复取是同一个组件。
        expect(registry.state("test.viewer.image")).toEqual(ready);

        await contributor.context?.scope.parent?.close();
        expect(registry.state("test.viewer.image").kind).toBe("gone");
    });

    it("贡献方暂存之后激活失败：它的编辑器为不在了，不停在未交付", async () => {
        const holder: {registry: EditorRegistry | null} = {registry: null};
        const application = await start([trap, brokenViewer], holder);
        expect(holder.registry!.state("test.broken.image").kind).toBe("pending");
        expect(await application.plugins.activate({plugin: "test.broken", entry: "browser"})).toMatchObject({status: "failed", stage: "prepare"});
        expect(holder.registry!.state("test.broken.image").kind).toBe("gone");
    });

    it("贡献点校验：id 要带插件前缀；按字节显示的编辑器必须声明 selector", async () => {
        const base = {capability: EDITOR_EDITORS_POINT, plugin: "test.viewer", entry: "browser", location: "browser" as const};
        expect(validateEditorContribution({...base, id: "test.viewer.image", declaration: VIEWER})).toBeNull();
        expect(validateEditorContribution({...base, id: "image", declaration: VIEWER})).not.toBeNull();
        expect(validateEditorContribution({...base, id: "test.viewer.image", declaration: {...VIEWER, selector: undefined}})).not.toBeNull();
        expect(validateEditorContribution({...base, id: "test.viewer.image", declaration: {...VIEWER, priority: "first"}})).not.toBeNull();
        expect(validateEditorContribution({...base, location: "server", id: "test.viewer.image", declaration: VIEWER})).not.toBeNull();
    });
});
