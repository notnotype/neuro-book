import {describe, expect, it} from "bun:test";

import ts from "typescript";

import {byCodeUnit, readSurface} from "./api-surface";

/** 用内存里的几份声明文件建程序，形状照 `build:package` 的产物：入口只有导入导出，声明在共享块里、导出名是压缩名。 */
function surfaceOf(files: Record<string, string>, entries: readonly string[] = ["index"], components: readonly string[] = []) {
    const paths = Object.fromEntries(Object.entries(files).map(([name, text]) => [`/pkg/${name}`, text]));
    const options: ts.CompilerOptions = {noEmit: true, strict: true, skipLibCheck: true, noLib: true, types: [], module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ESNext};
    const host = ts.createCompilerHost(options);
    host.fileExists = (name) => name in paths;
    host.readFile = (name) => paths[name];
    host.directoryExists = (name) => name === "/" || name === "/pkg";
    host.getDirectories = () => [];
    host.realpath = (name) => name;
    host.getCurrentDirectory = () => "/pkg";
    host.getSourceFile = (name, version) => (name in paths ? ts.createSourceFile(name, paths[name]!, version, true) : undefined);
    const program = ts.createProgram(Object.keys(paths), options, host);
    return readSurface(program, new Map(entries.map((entry) => [entry, `/pkg/${entry}.d.ts`])), new Set(components));
}

const entryOf = (...names: string[]) => `import { ${names.map((name, i) => `x${i} as ${name}`).join(", ")} } from "./shared.js";\nexport { ${names.join(", ")} };\n`;
const shared = (body: string, ...names: string[]) => `${body}\nexport { ${names.map((name, i) => `${name} as x${i}`).join(", ")} };\n`;

describe("api-surface：经检查器解到共享块里的真声明", () => {
    it("压缩的导出名解回公开名；种类、标注、去注释的声明与引到的公开名字都取得到", () => {
        const surface = surfaceOf({
            "index.d.ts": entryOf("makeBox", "Box"),
            "shared.d.ts": shared(
                [
                    "/** 一个盒子。\n * @experimental */\ninterface Box { readonly size: number }",
                    "/** 造一个盒子。\n * @experimental\n * @deprecated 改用别的。 */\ndeclare function makeBox(size: number): Box;",
                ].join("\n"),
                "makeBox",
                "Box",
            ),
        });
        expect(surface.problems).toEqual([]);
        expect(surface.entries[0]!.names).toEqual([
            {name: "Box", kind: "interface", stability: "experimental", deprecated: false, references: [], declarations: ["interface Box {\n    readonly size: number;\n}"]},
            {name: "makeBox", kind: "function", stability: "experimental", deprecated: true, references: ["Box"], declarations: ["declare function makeBox(size: number): Box;"]},
        ]);
    });

    it("名字按码元排序，大写在小写前，不随语言设置变", () => {
        const surface = surfaceOf({
            "index.d.ts": entryOf("b", "B", "a"),
            "shared.d.ts": shared(["/** @experimental */\ndeclare const b: 1;", "/** @experimental */\ntype B = 2;", "/** @experimental */\ndeclare const a: 3;"].join("\n"), "b", "B", "a"),
        });
        expect(surface.entries[0]!.names.map((item) => item.name)).toEqual(["B", "a", "b"]);
        expect(["b", "B", "a"].sort(byCodeUnit)).toEqual(["B", "a", "b"]);
    });
});

describe("api-surface：标注齐全", () => {
    it("缺标注、一处两个标注、几处声明不一致都报错", () => {
        const surface = surfaceOf({
            "index.d.ts": entryOf("none", "both", "split"),
            "shared.d.ts": shared(
                [
                    "declare const none: 1;",
                    "/** @experimental\n * @stable */\ndeclare const both: 2;",
                    "/** @stable */\ninterface split { a: 1 }\n/** @experimental */\ninterface split { b: 2 }",
                ].join("\n"),
                "none",
                "both",
                "split",
            ),
        });
        expect(surface.problems.filter((problem) => problem.severity === "error").map((problem) => [problem.name, problem.message])).toEqual([
            ["none", "missing @stable or @experimental on a declaration"],
            ["both", "more than one stability tag on a declaration"],
            ["split", "declarations disagree on stability"],
        ]);
    });

    it("重载每个签名都要标：只标第一个时第二个报缺", () => {
        const surface = surfaceOf({
            "index.d.ts": entryOf("over"),
            "shared.d.ts": shared("/** @experimental */\ndeclare function over(a: string): void;\ndeclare function over(a: number): void;", "over"),
        });
        expect(surface.problems.map((problem) => problem.message)).toEqual(["missing @stable or @experimental on a declaration"]);
        expect(surface.entries[0]!.names[0]!.declarations).toHaveLength(2);
    });

    it("只认紧贴声明的最后一块：标签在前一块时报缺，并警告标签放错了块", () => {
        const surface = surfaceOf({
            "index.d.ts": entryOf("early"),
            "shared.d.ts": shared("/** 文件头 @experimental */\n/** 自己的说明 */\ndeclare const early: 1;", "early"),
        });
        expect(surface.problems.map((problem) => [problem.severity, problem.message])).toEqual([
            ["warning", "a stability tag sits in an earlier comment block that TypeScript does not read"],
            ["error", "missing @stable or @experimental on a declaration"],
        ]);
    });

    it("变量的标注在语句上读得到；一个语句声明几个名字的报错", () => {
        const surface = surfaceOf({
            "index.d.ts": entryOf("one", "two"),
            "shared.d.ts": shared("/** @experimental */\ndeclare const one: 1, two: 2;", "one", "two"),
        });
        expect(surface.entries[0]!.names.map((item) => [item.name, item.stability])).toEqual([["one", "experimental"], ["two", null]]);
        expect(surface.problems.filter((problem) => problem.name === "one").map((problem) => problem.message)).toEqual(["declared together with other names in one statement; only the first declarator gets the JSDoc tag"]);
    });

    it("组件只核标注，不打印、不参与引用遍历", () => {
        const surface = surfaceOf(
            {
                "index.d.ts": entryOf("Widget"),
                "shared.d.ts": shared("type __VLS_Props = { hidden: Secret };\ntype Secret = 1;\n/** @experimental */\ndeclare const _default: __VLS_Props;", "_default"),
            },
            ["index"],
            ["Widget"],
        );
        expect(surface.problems).toEqual([]);
        expect(surface.entries[0]).toEqual({entry: "index", names: [{name: "Widget", kind: "component", stability: "experimental", deprecated: false, references: [], declarations: []}], unexported: []});
    });

    it("打印出来含 `$` 加数字或 `__VLS` 的非组件声明报错", () => {
        const surface = surfaceOf({
            "index.d.ts": entryOf("clash"),
            "shared.d.ts": shared("type Box$1 = 1;\n/** @experimental */\ndeclare const clash: Box$1;", "clash"),
        });
        expect(surface.problems.filter((problem) => problem.severity === "error").map((problem) => problem.message)).toEqual(["printed declaration contains a mangled name ($N or __VLS); rename the clashing declaration"]);
    });
});

describe("api-surface：可达未导出与闭包", () => {
    it("从公开名字沿类型与值引用遍历到不动点：没导出的类型、计算属性键用的值都列出并告警", () => {
        const surface = surfaceOf({
            "index.d.ts": entryOf("place", "Kind"),
            "shared.d.ts": shared(
                [
                    "type Item = { readonly at: Inner };",
                    "type Inner = 1;",
                    "type Placement = { readonly items: readonly Item[] };",
                    "declare const brand: unique symbol;",
                    "/** @experimental */\ninterface Kind { readonly [brand]?: true }",
                    "/** @experimental */\ndeclare function place(): Placement;",
                ].join("\n"),
                "place",
                "Kind",
            ),
        });
        expect(surface.entries[0]!.unexported.map((item) => [item.name, item.kind])).toEqual([["Inner", "type"], ["Item", "type"], ["Placement", "type"], ["brand", "const"]]);
        expect(surface.problems.filter((problem) => problem.severity === "warning").map((problem) => problem.name).sort(byCodeUnit)).toEqual(["Inner", "Item", "Placement", "brand"]);
        expect(surface.problems.filter((problem) => problem.severity === "error")).toEqual([]);
    });

    it("`@stable` 名字引到 `@experimental` 的公开名字或没导出的声明时报错", () => {
        const surface = surfaceOf({
            "index.d.ts": entryOf("solid", "Loose", "Fine"),
            "shared.d.ts": shared(
                ["/** @experimental */\ntype Loose = 1;", "/** @stable */\ntype Fine = 2;", "type Hidden = 3;", "/** @stable */\ndeclare function solid(a: Loose, b: Fine): Hidden;"].join("\n"),
                "solid",
                "Loose",
                "Fine",
            ),
        });
        expect(surface.problems.filter((problem) => problem.severity === "error").map((problem) => [problem.name, problem.message])).toEqual([
            ["solid", "@stable but its signature references names that are not @stable: Loose"],
            ["solid", "@stable but its signature references unexported declarations: Hidden"],
        ]);
    });

    it("几个入口都看得到同一个公开名字：引用记的是公开名，不算没导出", () => {
        const surface = surfaceOf(
            {
                "index.d.ts": `import { x1 as Shape } from "./shared.js";\nexport { Shape };\n`,
                "vue.d.ts": entryOf("useShape", "Shape"),
                "shared.d.ts": shared("/** @experimental */\ntype Shape = 1;\n/** @experimental */\ndeclare function useShape(): Shape;", "useShape", "Shape"),
            },
            ["index", "vue"],
        );
        expect(surface.entries.map((entry) => [entry.entry, entry.names.map((item) => [item.name, item.references]), entry.unexported])).toEqual([
            ["index", [["Shape", []]], []],
            ["vue", [["Shape", []], ["useShape", ["Shape"]]], []],
        ]);
    });
});
