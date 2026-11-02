/**
 * SDK 的公开面闭包（docs/specs/runtime/plugin-api.md 的“边界与兼容”）：从子路径表的每个入口出发，按运行时的导入（含动态导入与 `.vue`
 * 文件里的导入）走到的应用源文件，也就是 SDK 包里随构建期实现一起分发的那些。导出的名字由 `sdk.test.ts` 与 `plugin-sdk/pack.test.ts`
 * 钉住；这里钉住名字背后连带分发的实现，新文件进入闭包时这里失败，评审时看一眼它是不是有意公开的，不是的话改成从叶子模块取。
 * 导入按语法树读（`src/testing/source-imports.ts`），与 `architecture.test.ts` 同一份。
 */

import {describe, expect, it} from "bun:test";
import {readFileSync, statSync} from "node:fs";
import {dirname, join, normalize, relative} from "node:path";

import {SDK_ENTRIES} from "nbook/sdk/entries";
import type {SdkEntry} from "nbook/sdk/entries";
import {sourceImports} from "nbook/testing/source-imports";

const SRC = join(import.meta.dir, "..");

/** 应用源码里的导入目标；包名与 node 内置返回 null。 */
function resolveInSrc(specifier: string, from: string): string | null {
    const base = specifier.startsWith("nbook/") ? join(SRC, specifier.slice("nbook/".length)) : specifier.startsWith(".") ? normalize(join(dirname(from), specifier)) : null;
    if (base === null) return null;
    const found = [base, `${base}.ts`, `${base}.vue`, join(base, "index.ts")].find((candidate) => statSync(candidate, {throwIfNoEntry: false})?.isFile() === true);
    if (found !== undefined) return found;
    throw new Error(`${relative(SRC, from)} 导入的 ${specifier} 找不到`);
}

/** 从这些文件出发按运行时导入走到的应用源文件（不含 `sdk/` 自己），与路上导入的包名。 */
function closure(entries: ReadonlyArray<string>): {readonly files: string[]; readonly packages: string[]} {
    const seen = new Set<string>();
    const packages = new Set<string>();
    const stack = [...entries];
    while (stack.length > 0) {
        const file = stack.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        // 运行时的导入：`import type`、`export type` 不带出实现，不算。
        for (const use of sourceImports(file, readFileSync(file, "utf8"))) {
            if (use.typeOnly) continue;
            const target = resolveInSrc(use.specifier, file);
            if (target !== null) stack.push(target);
            else if (!use.specifier.startsWith("node:")) packages.add(use.specifier);
        }
    }
    return {files: [...seen].map((file) => relative(SRC, file)).filter((file) => !file.startsWith("sdk/")).sort(), packages: [...packages].sort()};
}

const entryClosure = (entry: SdkEntry) => closure([join(SRC, "sdk", entry.file)]);

describe("SDK 的公开面闭包", () => {
    // `@notnotype/nb-ui/text` 是文字值的纯数据层（docs/specs/ui/i18n.md）：没有外部依赖、不引 Vue，服务端也用它解析语言映射。
    it("服务端可用的子路径不连带 Vue：没有单文件组件，也不导入 vue 与 nb-ui（nb-ui 的纯数据层除外）", () => {
        for (const entry of SDK_ENTRIES.filter((item) => item.server)) {
            const {files, packages} = entryClosure(entry);
            expect({entry: entry.specifier, vueFiles: files.filter((file) => file.endsWith(".vue")), vuePackages: packages.filter((name) => name === "vue" || name.startsWith("@vue/runtime") || (name.startsWith("@notnotype/nb-ui") && name !== "@notnotype/nb-ui/text"))}).toEqual({entry: entry.specifier, vueFiles: [], vuePackages: []});
        }
    });

    it("各子路径连带公开的应用源文件", () => {
        // 命令插件的快捷键与菜单经它的合同模块再导出（别的插件按规则只能从合同模块取），所以跟着命令点进来。
        const actual: Readonly<Record<string, ReadonlyArray<string>>> = Object.fromEntries(SDK_ENTRIES.map((entry) => [entry.subpath, entryClosure(entry).files]));
        expect(actual).toEqual(CLOSURES);
    });
});

/** 每个子路径连带分发的应用源文件。 */
const CLOSURES: Readonly<Record<string, ReadonlyArray<string>>> = {
    ".": ["plugin-platform/shared/descriptor-check.ts", "shared/host.ts"],
    "./text": ["shared/plugin-text.ts"],
    "./text/browser": ["shared/plugin-text.ts", "shared/use-plugin-text.ts"],
    "./state": ["plugins/state/shared/contracts.ts", "shared/store/persisted.ts", "shared/store/public.ts", "shared/store/store.ts"],
    "./storage": ["plugins/storage/shared/contracts.ts", "shared/storage.ts"],
    "./files": ["plugins/files/shared/workspace-files.ts"],
    "./settings": ["plugin-platform/shared/descriptor-check.ts", "plugins/settings/shared/contracts.ts", "plugins/settings/shared/sections.ts", "plugins/settings/shared/text.ts", "shared/convention-keys.ts", "shared/host-locales.ts", "shared/plugin-text.ts", "shared/settings.ts", "shared/text.ts"],
    "./settings/browser": [
        "plugin-platform/shared/descriptor-check.ts",
        "plugins/settings/shared/sections.ts",
        "plugins/settings/web/page-contribution.ts",
        "shared/convention-keys.ts",
        "shared/settings.ts",
        "shared/text.ts",
        "ui/bound-component.ts",
        "ui/settings/HighlightedText.vue",
        "ui/settings/SettingsPageActions.vue",
        "ui/settings/SettingsPageList.vue",
        "ui/settings/SettingsRow.vue",
        "ui/settings/SettingsSaveBar.vue",
        "ui/settings/highlight.ts",
        "ui/settings/page-chrome.ts",
        "ui/settings/row-state.ts",
        "ui/settings/setting-text.ts",
        "ui/settings/settings-page.ts",
        "ui/settings/text.ts",
    ],
    "./agent": ["plugins/agent/shared/points.ts"],
    "./agent/jsx-runtime": [],
    "./commands": ["plugin-platform/shared/descriptor-check.ts", "plugins/commands/shared/contracts.ts", "plugins/commands/shared/keybinding.ts", "plugins/commands/shared/menus.ts", "shared/convention-keys.ts", "shared/text.ts"],
    "./workbench": ["plugin-platform/shared/descriptor-check.ts", "plugins/workbench/shared/items.ts", "plugins/workbench/shared/views.ts", "plugins/workbench/web/view-contribution.ts", "shared/convention-keys.ts", "shared/text.ts", "ui/bound-component.ts"],
    "./components": [],
};
