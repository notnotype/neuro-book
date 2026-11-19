/**
 * SDK 的导出面（docs/specs/runtime/plugin-api.md 的“SDK”“边界与兼容”）：每导出一项都进入 `engines.neurobook` 的兼容
 * 范围，这里把运行时导出的名字钉住，增删都要显式改这份清单。类型导出的名字由 `build:sdk` 生成的声明文件另行核对。
 */

import {describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

import {moduleExports} from "@notnotype/neuro-book-test-support/module-exports";

import {SDK_ENTRIES} from "./entries";

const PACKAGE_ROOT = join(import.meta.dir, "..", "..");

/** 一份 tsconfig 里 SDK 包名的路径别名（tsconfig 允许注释与尾逗号，这里的两份没有，按 JSON 读）。 */
function sdkPaths(file: string): Record<string, ReadonlyArray<string>> {
    const config = JSON.parse(readFileSync(join(PACKAGE_ROOT, file), "utf8")) as {compilerOptions: {paths: Record<string, ReadonlyArray<string>>}};
    return Object.fromEntries(Object.entries(config.compilerOptions.paths).filter(([name]) => name.startsWith("@notnotype/nb-plugin-sdk")));
}

describe("SDK 的导出面", () => {
    // 每个子路径的运行时导出，按子路径表的顺序。只给浏览器的几个也在 Bun 里导入：它们只再导出，单文件组件经测试的预加载编译。
    const EXPORTS: Readonly<Record<string, ReadonlyArray<string>>> = {
        "index": ["defineEntry", "definePlugin", "defineRemoteService", "defineServiceKey", "diagnosticsKey", "eventSource", "fail", "hostClockKey", "hostStateRootKey", "ok", "orThrow", "provideRemote", "provideService", "provideServicePerConsumer", "remoteService"],
        "text": ["pluginText"],
        "text-browser": ["usePluginText", "useText"],
        "state": ["definePublicState", "defineStore"],
        "storage": ["defineRecord", "storageKey"],
        "files": ["baselineOf", "workspaceFilesKey"],
        "settings": ["SETTINGS_CHOICES_POINT", "SETTINGS_PAGES_POINT", "SETTINGS_SECTIONS_POINT", "defineSetting", "displayLocale", "section", "setting", "settingsChoicesEvent", "settingsKey"],
        "settings-browser": ["SettingsPageActions", "SettingsPageList", "SettingsRow", "SettingsSaveBar", "choices", "settingsPage"],
        "commands": ["COMMANDS_POINT", "command", "commandServiceKey"],
        "agent": ["Assistant", "COMPACTION_METHODS_POINT", "EVAL_OBJECTS_POINT", "EXTENSIONS_POINT", "Fragment", "History", "If", "P", "PROFILES_POINT", "SKILLS_POINT", "Slot", "System", "TOOLS_POINT", "Tag", "ToolName", "Turn", "User", "agentCompactionMethod", "agentExtension", "agentProfile", "agentSkills", "agentTool", "conv", "coreHistory", "defineContract", "defineExtension", "defineProfile", "evalObject", "ext", "finalOnly", "implement", "mapEventContent", "mergeSteers", "opening", "optional", "reminder", "shape", "slice", "standardLayout", "withoutEvents"],
        "agent-jsx-runtime": ["Fragment", "jsx", "jsxs"],
        "workbench": ["OPEN_VIEW_COMMAND", "WORKBENCH_STATUSBAR_ITEMS_POINT", "WORKBENCH_THEMES_POINT", "WORKBENCH_THEME_SCENES_POINT", "WORKBENCH_VIEWS_POINT", "WORKBENCH_VIEW_CONTAINERS_POINT", "sceneProvider", "statusItem", "view"],
    };

    it("每个子路径的运行时导出；子路径表里除组件以外的子路径都在这张清单上", async () => {
        expect(SDK_ENTRIES.map((entry) => entry.file.replace(/\.ts$/u, "")).filter((name) => name !== "components")).toEqual(Object.keys(EXPORTS));
        for (const [file, names] of Object.entries(EXPORTS)) {
            expect({file, names: Object.keys(await import(`./${file}`) as object).sort()}).toEqual({file, names: [...names].sort()});
        }
    });

    it("组件子路径逐个列名，与 nb-ui、nb-layout、nb-workbench-layout 入口里的单文件组件逐个对上：新增组件漏列、或列了入口里没有的，这里失败", () => {
        const sdk = readFileSync(join(import.meta.dir, "components.ts"), "utf8");
        expect(sdk).not.toMatch(/export \*/u);
        const entries = ["@notnotype/nb-ui/components", "@notnotype/nb-layout/vue", "@notnotype/nb-workbench-layout/vue"].map((name) => readFileSync(fileURLToPath(import.meta.resolve(name)), "utf8"));
        const listed = exportedValues(sdk).map((item) => item.name).sort();
        // nb-ui 里冻结的 Splitter 与 nb-layout 的同名（w00026 t14 迁移前），只算一个。
        const components = [...new Set(entries.flatMap((entry) => exportedValues(entry).filter((item) => item.from.endsWith(".vue")).map((item) => item.name)))].filter((name) => !Object.hasOwn(NOT_FOR_PLUGINS, name)).sort();
        expect(listed).toEqual(components);
    });

    it("组件子路径的类型与 nb-ui 组件入口的公共类型逐个对上：nb-ui 新增或改名的类型漏列时这里失败", () => {
        // 弃用别名两边都剔除：它们是 SDK 自己的兼容承诺，与 nb-ui 入口无关（nb-ui 里冻结的旧 Splitter 碰巧也导出同名的，t14 后就没了）。
        const sdk = exportedTypes(readFileSync(join(import.meta.dir, "components.ts"), "utf8")).filter((name) => !Object.hasOwn(DEPRECATED_ALIASES, name)).sort();
        const nbUi = exportedTypes(readFileSync(fileURLToPath(import.meta.resolve("@notnotype/nb-ui/components")), "utf8")).filter((name) => !Object.hasOwn(DEPRECATED_ALIASES, name)).sort();
        // 布局的类型由 nb-layout 与 nb-workbench-layout 提供，SDK 只挑给插件用的那些，不要求逐个对上。
        const layout = new Set(["@notnotype/nb-layout", "@notnotype/nb-layout/vue", "@notnotype/nb-workbench-layout", "@notnotype/nb-workbench-layout/vue"].flatMap((name) => exportedTypes(readFileSync(fileURLToPath(import.meta.resolve(name)), "utf8"))));
        expect(sdk.filter((name) => !layout.has(name))).toEqual(nbUi.filter((name) => !layout.has(name)));
    });

    it("弃用别名都在 components.ts 里声明，指向表里写的新名，新名也导出", () => {
        const source = readFileSync(join(import.meta.dir, "components.ts"), "utf8");
        const types = new Set(exportedTypes(source));
        for (const [alias, {replacement}] of Object.entries(DEPRECATED_ALIASES)) {
            expect({alias, declared: types.has(alias), replacement: types.has(replacement)}).toEqual({alias, declared: true, replacement: true});
            expect(source).toMatch(new RegExp(`@deprecated 改用 \`${replacement}\`。 \\*/\\nexport type ${alias} = `, "u"));
        }
    });
});

/** SDK 留给插件的弃用别名：旧名、新名与理由。去掉别名时从这里删掉对应一行。 */
const DEPRECATED_ALIASES: Readonly<Record<string, {readonly replacement: string; readonly reason: string}>> = {
    SplitterGestureSource: {replacement: "SashGestureSource", reason: "w00026 t36：NestedGrid 与 Splitter 共用的手势来源，改名后保留旧名一个弃用期"},
    SplitterGestureCancelReason: {replacement: "SashGestureCancelReason", reason: "同上，取消原因"},
};

/** nb-ui 组件入口里不给插件用的单文件组件，与理由。现在没有。 */
const NOT_FOR_PLUGINS: Readonly<Record<string, string>> = {};

/** 模块里非 `type` 的导出：导出名与来源（读语法树，不执行：单文件组件 Bun 加载不了）。 */
const exportedValues = (text: string): Array<{readonly name: string; readonly from: string}> => moduleExports(text).filter((item) => item.kind === "value");

/** 模块里的类型导出：`type` 的再导出与就地声明的类型。 */
const exportedTypes = (text: string): string[] => moduleExports(text).filter((item) => item.kind === "type").map((item) => item.name);

describe("SDK 的子路径表", () => {
    it("两份 tsconfig 的 SDK 别名与子路径表一致：新增子路径漏改一处时这里失败", () => {
        const expected = Object.fromEntries(SDK_ENTRIES.map((entry) => [entry.specifier, [`./src/sdk/${entry.file}`]]));
        expect(sdkPaths("tsconfig.json")).toEqual(expected);
        expect(sdkPaths("tsconfig.web.json")).toEqual(expected);
    });
});
