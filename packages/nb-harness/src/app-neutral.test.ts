/**
 * nb-harness 与应用无关：NeuroBook 与 NeuroBot 共用它，应用专有的地址、文字与 id 由宿主传入。非测试源码（含注释）不写任何应用的
 * 名字，不导入应用包与 nb-runtime（插件平台是宿主的事，harness 只对形状），`package.json` 也不依赖它们。
 * 照 `packages/nb-runtime/src/app-neutral.test.ts` 的写法；测试文件不受约束（它们可以用应用里的 id 做样例，但 kit 的测试也用中性 id）。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";
import ts from "typescript";

const SRC = import.meta.dir;
/** 现有的应用名。出现新的应用时把它的名字加进来。 */
const APP_NAMES = /nbook|neurobook|nbot|neurobot/iu;
/** 应用包、应用内的路径别名与 nb-runtime。 */
const FORBIDDEN_IMPORTS = ["nbook/", "@notnotype/neuro-book", "@notnotype/neuro-bot", "@notnotype/nb-runtime"];

function sources(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sources(path);
        return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [path] : [];
    });
}

/**
 * 一个文件里全部导入与转出的说明符（含 `import type`、`import("…")` 类型与动态导入）。只要说明符、不分值与类型，用词法预扫描：
 * 比建语法树快一个数量级，扫整个 `src/` 才放得进快速测试的预算。
 */
function specifiersOf(file: string): string[] {
    return ts.preProcessFile(readFileSync(file, "utf8"), true, true).importedFiles.map((entry) => entry.fileName);
}

const forbiddenImport = (specifier: string): boolean => FORBIDDEN_IMPORTS.some((prefix) => specifier === prefix.replace(/\/$/u, "") || specifier.startsWith(prefix));

describe("nb-harness 与应用无关", () => {
    const files = sources(SRC);

    it("非测试源码（含注释）不出现应用名", () => {
        const found = files.flatMap((file) => readFileSync(file, "utf8").split("\n").flatMap((line, index) => (APP_NAMES.test(line) ? [`${relative(SRC, file)}:${String(index + 1)}：${line.trim()}`] : [])));
        expect(found).toEqual([]);
    });

    it("非测试源码不导入应用包、应用的路径别名与 nb-runtime", () => {
        const found = files.flatMap((file) => specifiersOf(file).filter(forbiddenImport).map((specifier) => `${relative(SRC, file)}：${specifier}`));
        expect(found).toEqual([]);
    });

    it("package.json 的依赖里没有应用包与 nb-runtime", () => {
        const manifest = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8")) as {dependencies?: Record<string, string>; peerDependencies?: Record<string, string>};
        const names = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})];
        expect(names.filter(forbiddenImport)).toEqual([]);
    });

    it("检查本身认得出违规的写法", () => {
        for (const name of ["NeuroBook", "nbook.agent.read", "NeuroBot", "nbot"]) expect(APP_NAMES.test(name)).toBe(true);
        expect(APP_NAMES.test("harness")).toBe(false);
        for (const specifier of ["nbook/plugins/files/shared/contracts", "@notnotype/neuro-book", "@notnotype/neuro-book/sdk", "@notnotype/neuro-bot", "@notnotype/nb-runtime/plugins"]) expect(forbiddenImport(specifier)).toBe(true);
        expect(forbiddenImport("@notnotype/nb-form")).toBe(false);
        expect(forbiddenImport("@notnotype/nb-session")).toBe(false);
    });
});
