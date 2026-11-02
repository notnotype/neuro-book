/**
 * SDK 的导出面（docs/specs/runtime/plugin-api.md 的“SDK”“边界与兼容”）：每导出一项都进入 `engines.neurobook` 的兼容
 * 范围，这里把运行时导出的名字钉住，增删都要显式改这份清单。类型导出的名字由 `build:sdk` 生成的声明文件另行核对。
 */

import {describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

import ts from "typescript";

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
        "settings": ["SETTINGS_CHOICES_POINT", "SETTINGS_PAGES_POINT", "SETTINGS_SECTIONS_POINT", "defineSetting", "displayLocale", "section", "setting", "settingsChoicesEvent", "settingsKey"],
        "settings-browser": ["SettingsPageActions", "SettingsPageList", "SettingsRow", "SettingsSaveBar", "choices", "settingsPage"],
        "commands": ["COMMANDS_POINT", "command", "commandServiceKey"],
        "agent": ["Assistant", "EXTENSIONS_POINT", "Fragment", "History", "If", "P", "PROFILES_POINT", "Slot", "System", "TOOLS_POINT", "Tag", "ToolName", "Turn", "User", "agentExtension", "agentProfile", "agentTool", "conv", "coreHistory", "defineContract", "defineExtension", "defineProfile", "ext", "finalOnly", "implement", "mapEventContent", "opening", "optional", "reminder", "shape", "slice", "standardLayout", "withoutEvents"],
        "agent-jsx-runtime": ["Fragment", "jsx", "jsxs"],
        "workbench": ["OPEN_VIEW_COMMAND", "WORKBENCH_STATUSBAR_ITEMS_POINT", "WORKBENCH_VIEWS_POINT", "statusItem", "view"],
    };

    it("每个子路径的运行时导出；子路径表里除组件以外的子路径都在这张清单上", async () => {
        expect(SDK_ENTRIES.map((entry) => entry.file.replace(/\.ts$/u, "")).filter((name) => name !== "components")).toEqual(Object.keys(EXPORTS));
        for (const [file, names] of Object.entries(EXPORTS)) {
            expect({file, names: Object.keys(await import(`./${file}`) as object).sort()}).toEqual({file, names: [...names].sort()});
        }
    });

    it("组件子路径逐个列名，与 nb-ui 组件入口里的单文件组件逐个对上：nb-ui 新增组件漏列、或列了入口里没有的，这里失败", () => {
        const sdk = readFileSync(join(import.meta.dir, "components.ts"), "utf8");
        expect(sdk).not.toMatch(/export \*/u);
        const nbUi = fileURLToPath(import.meta.resolve("@notnotype/nb-ui/components"));
        const listed = exportedValues(sdk).map((item) => item.name).sort();
        const components = exportedValues(readFileSync(nbUi, "utf8")).filter((item) => item.from.endsWith(".vue")).map((item) => item.name).filter((name) => !Object.hasOwn(NOT_FOR_PLUGINS, name)).sort();
        expect(listed).toEqual(components);
    });

    it("组件子路径的类型与 nb-ui 组件入口的公共类型逐个对上：nb-ui 新增或改名的类型漏列时这里失败", () => {
        const sdk = exportedTypes(readFileSync(join(import.meta.dir, "components.ts"), "utf8")).sort();
        const nbUi = exportedTypes(readFileSync(fileURLToPath(import.meta.resolve("@notnotype/nb-ui/components")), "utf8")).sort();
        expect(sdk).toEqual(nbUi);
    });
});

/** nb-ui 组件入口里不给插件用的单文件组件，与理由。现在没有。 */
const NOT_FOR_PLUGINS: Readonly<Record<string, string>> = {};

/** 模块里非 `type` 的具名再导出：导出名与来源。读语法树，不执行（单文件组件 Bun 加载不了）。 */
function exportedValues(text: string): Array<{readonly name: string; readonly from: string}> {
    const source = ts.createSourceFile("module.ts", text, ts.ScriptTarget.Latest);
    return source.statements.flatMap((statement) => {
        if (!ts.isExportDeclaration(statement) || statement.isTypeOnly || statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause)) return [];
        const from = statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : "";
        return statement.exportClause.elements.filter((element) => !element.isTypeOnly).map((element) => ({name: element.name.text, from}));
    });
}

/** 模块里 `type` 的具名再导出（整条 `export type {…}` 或单个 `type` 修饰的名字）。 */
function exportedTypes(text: string): string[] {
    const source = ts.createSourceFile("module.ts", text, ts.ScriptTarget.Latest);
    return source.statements.flatMap((statement) => {
        if (!ts.isExportDeclaration(statement) || statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause)) return [];
        return statement.exportClause.elements.filter((element) => statement.isTypeOnly || element.isTypeOnly).map((element) => element.name.text);
    });
}

describe("SDK 的子路径表", () => {
    it("两份 tsconfig 的 SDK 别名与子路径表一致：新增子路径漏改一处时这里失败", () => {
        const expected = Object.fromEntries(SDK_ENTRIES.map((entry) => [entry.specifier, [`./src/sdk/${entry.file}`]]));
        expect(sdkPaths("tsconfig.json")).toEqual(expected);
        expect(sdkPaths("tsconfig.web.json")).toEqual(expected);
    });
});
