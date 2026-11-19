/**
 * 公开面（Spec `ui/nested-grid` 的“边界与兼容”）：每个子路径的入口是一行一个名字的显式清单，入口里的名字就是公开面。
 *
 * - 入口不用 `export *`、不用默认导出：入口文件本身就是提交进仓库的清单，加一个导出就是改这份清单，评审时看得见。
 * - 文档里教人导入的名字都在入口里：包内文档与三份 Spec 的代码块没人编译，写错或入口删了名字只有这里拦得下。
 * - 导出名与数据属性里不出现工作台概念（`AGENTS.md`“边界”）。规则里的概念与禁用词的对应：活动栏 `activity`、状态栏
 *   `statusbar`（含 `status` 后接 `bar`）、区域 `region`、容器 `container`、编辑组 `editor`、具名面板 `explorer`、`terminal`、
 *   `sidebar`，再加 `workbench`。只扫导出名与 `data-*`、`dataset.*`，不扫成员名：`containerRect`、键盘配置里的 `region` 是通用意义。
 *   `entry`、`float`、`panel`、`section` 是通用的布局词，不禁。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";

import {hasDefaultExport, hasStarExport, moduleExports} from "@notnotype/neuro-book-test-support/module-exports";

const PACKAGE_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PACKAGE_ROOT, "../..");
const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {exports: Record<string, string>};

/** `package.json` 的每个子路径，`./lab-sources` 除外：它给应用的 Component Lab 建索引，不进发布包。 */
const ENTRIES = Object.entries(manifest.exports).filter(([subpath]) => subpath !== "./lab-sources").map(([subpath, file]) => ({
    specifier: subpath === "." ? "@notnotype/nb-layout" : `@notnotype/nb-layout/${subpath.slice(2)}`,
    file: join(PACKAGE_ROOT, file),
}));

const entryText = (file: string): string => readFileSync(file, "utf8");

const BANNED = ["workbench", "activity", "statusbar", "region", "container", "editor", "sidebar", "explorer", "terminal"];

/** 把名字切成小写的词（驼峰、连字符、下划线、点），`status` 后接 `bar` 合成 `statusbar`。 */
function words(name: string): string[] {
    const parts = name.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2").split(/[\s\-_.]+/u).map((part) => part.toLowerCase()).filter((part) => part !== "");
    return parts.flatMap((part, index) => (part === "status" && parts[index + 1] === "bar" ? ["statusbar"] : [part]));
}

const banned = (name: string): string[] => words(name).filter((word) => BANNED.includes(word));

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.(ts|vue)$/u.test(entry.name) && !/\.test\.ts$/u.test(entry.name) ? [path] : [];
    });
}

/** 源码里的数据属性名：模板与选择器里的 `data-*`，脚本里的 `dataset.*`（换回连字符写法）。 */
function dataAttributes(text: string): string[] {
    const attributes = [...text.matchAll(/\bdata-[a-z][a-z0-9-]*/gu)].map((match) => match[0]);
    const datasets = [...text.matchAll(/\bdataset\.([a-zA-Z]+)/gu)].map((match) => `data-${match[1]!.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`);
    return [...attributes, ...datasets];
}

/** 文档代码块里从本包导入的名字：`{specifier, name}`。 */
function documentedImports(text: string): Array<{readonly specifier: string; readonly name: string}> {
    return [...text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"(@notnotype\/nb-layout(?:\/[a-z-]+)?)"/gsu)].flatMap((match) => match[1]!.split(",").map((raw) => ({
        specifier: match[2]!,
        name: raw.trim().replace(/^type\s+/u, "").split(/\s+as\s+/u)[0]!.trim(),
    })).filter((item) => item.name !== ""));
}

function markdownFiles(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" ? [] : markdownFiles(path);
        return entry.name.endsWith(".md") ? [path] : [];
    });
}

describe("nb-layout 的公开面", () => {
    it("每个入口都是显式清单：没有 `export *`、没有默认导出", () => {
        expect(ENTRIES.map((entry) => entry.specifier).sort()).toEqual(["@notnotype/nb-layout", "@notnotype/nb-layout/locales", "@notnotype/nb-layout/text", "@notnotype/nb-layout/vue"]);
        for (const entry of ENTRIES) {
            const text = entryText(entry.file);
            expect({entry: entry.specifier, star: hasStarExport(text), defaultExport: hasDefaultExport(text)}).toEqual({entry: entry.specifier, star: false, defaultExport: false});
        }
    });

    it("具名再导出一行一个名字：加一个导出在评审里是单独的一行", () => {
        const crowded = ENTRIES.flatMap((entry) => entryText(entry.file).split("\n").flatMap((line, index) => (/^export (?:type )?\{[^}]*,[^}]*\}/u.test(line) ? [`${relative(PACKAGE_ROOT, entry.file)}:${String(index + 1)}`] : [])));
        expect(crowded).toEqual([]);
    });

    it("包内文档与三份 Spec 的代码块里从本包导入的名字，都在对应入口里", () => {
        const exported = new Map(ENTRIES.map((entry) => [entry.specifier, new Set(moduleExports(entryText(entry.file)).map((item) => item.name))]));
        const documents = [...markdownFiles(PACKAGE_ROOT), ...["ui/nested-grid.md", "ui/layout-drag.md", "ui/sortable-list.md"].map((name) => join(REPO_ROOT, "docs/specs", name))];
        const missing = documents.flatMap((file) => documentedImports(readFileSync(file, "utf8")).filter((item) => exported.get(item.specifier)?.has(item.name) !== true).map((item) => `${relative(REPO_ROOT, file)}: ${item.name} from ${item.specifier}`));
        expect(missing).toEqual([]);
    });

    it("导出名里没有工作台概念", () => {
        const found = ENTRIES.flatMap((entry) => moduleExports(entryText(entry.file)).flatMap((item) => (banned(item.name).length > 0 ? [`${entry.specifier}: ${item.name}`] : [])));
        expect(found).toEqual([]);
    });

    it("源码里的数据属性没有工作台概念", () => {
        const found = sourceFiles(join(PACKAGE_ROOT, "src")).flatMap((file) => dataAttributes(readFileSync(file, "utf8")).filter((name) => banned(name).length > 0).map((name) => `${relative(PACKAGE_ROOT, file)}: ${name}`));
        expect(found).toEqual([]);
    });

    it("这几条检查拦得下违规的写法", () => {
        expect(hasStarExport(`export * from "./grid";`)).toBe(true);
        expect(hasDefaultExport(`export default 1;`)).toBe(true);
        expect(banned("ActivityBarStrip")).toEqual(["activity"]);
        expect(banned("statusBarHeight")).toEqual(["statusbar"]);
        expect(banned("EditorGroupDrop")).toEqual(["editor"]);
        expect(banned("entryRect")).toEqual([]);
        expect(banned("FloatWindowHandles")).toEqual([]);
        expect(dataAttributes(`<div data-region-drop :x="el.dataset.containerId" />`).flatMap(banned)).toEqual(["region", "container"]);
        expect(documentedImports(`import {createGrid, type GridNode} from "@notnotype/nb-layout";`)).toEqual([{specifier: "@notnotype/nb-layout", name: "createGrid"}, {specifier: "@notnotype/nb-layout", name: "GridNode"}]);
    });
});
