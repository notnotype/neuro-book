/**
 * 示例应用（`examples/*`）是给第三方照抄的：每个目录拷走、装依赖就能跑，所以只能经公开入口用本包。
 * 示例在包目录里、经工作区链接读本包源码，`../../src` 这样的相对导入照样能编译、能构建、e2e 能过，只有拷走才坏：
 * 类型检查拦不住，这里是唯一的一道。导入按文字扫描、宁可误报（教学注释里别写完整的导入语句），`new URL(…)` 不覆盖。
 */

import {describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";

import {scanImports, sourceFiles, type ImportRule} from "@notnotype/neuro-book-test-support/import-boundary";

import {exampleDir, exampleNames} from "../scripts/examples";

const PACKAGE = join(import.meta.dir, "..");
const own = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as {version: string};
const names = await exampleNames();

type Manifest = {license?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>};
const manifestOf = (name: string) => JSON.parse(readFileSync(join(exampleDir(name), "package.json"), "utf8")) as Manifest;

/** 只认 `^主.次.修订`：0.x 里 `^0.2.0` 只接 0.2.x，正是要核的那一点。 */
function caretAccepts(range: string, version: string): boolean {
    const wanted = /^\^(\d+)\.(\d+)\.(\d+)$/u.exec(range);
    const actual = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
    if (wanted === null || actual === null) return false;
    const [w, a] = [wanted.slice(1).map(Number), actual.slice(1).map(Number)];
    const atLeast = a[0]! > w[0]! || (a[0] === w[0] && (a[1]! > w[1]! || (a[1] === w[1] && a[2]! >= w[2]!)));
    const sameLine = w[0] === 0 ? a[0] === 0 && a[1] === w[1] : a[0] === w[0];
    return atLeast && sameLine;
}

describe("示例应用", () => {
    it("至少有一个示例", () => {
        expect(names.length).toBeGreaterThan(0);
    });

    it.each(names)("%s：MIT，依赖只有 nb-layout 与 vue，nb-layout 的范围接得住包的当前版本", (name) => {
        const manifest = manifestOf(name);
        // 目录被拷走后包的 LICENSE 就不在旁边了，示例自己带一份，package.json 也写明。
        expect(manifest.license).toBe("MIT");
        expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(["@notnotype/nb-layout", "vue"]);
        expect(Object.keys(manifest.devDependencies ?? {}).sort()).toEqual(["@vitejs/plugin-vue", "typescript", "vite", "vue-tsc"]);
        // 提 nb-layout 的版本时示例跟着改：不然照示例装到的是旧版本。
        expect(caretAccepts(manifest.dependencies!["@notnotype/nb-layout"]!, own.version)).toBe(true);
    });

    it("几个示例的依赖版本相同", () => {
        const versions = names.map((name) => {
            const {dependencies, devDependencies} = manifestOf(name);
            return JSON.stringify({dependencies, devDependencies});
        });
        expect(new Set(versions).size).toBe(1);
    });

    it.each(names)("%s：只经公开入口导入本包，不导入别的包，相对导入不出示例目录", (name) => {
        const root = exampleDir(name);
        const rule: ImportRule = {
            packages: [/^vue$/u, /^@notnotype\/nb-layout(?:\/(?:vue|text|locales|style\.css))?$/u, /^vite$/u, /^@vitejs\/plugin-vue$/u],
            within: root,
        };
        expect(scanImports(sourceFiles(root, new Set(["node_modules", "dist"])), rule)).toEqual([]);
    });

    it.each(names)("%s：文字里不引 Spec 的条目编号（第三方读不到仓库的 Spec）", (name) => {
        const root = exampleDir(name);
        const files = [...sourceFiles(root, new Set(["node_modules", "dist"])), join(root, "README.md")];
        const cited = files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/(?:输出|失败|验收) ?[0-9]+/gu)].map((match) => `${file}: ${match[0]}`));
        expect(cited).toEqual([]);
    });
});
