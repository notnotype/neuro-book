/**
 * nb-models 的边界：
 * - 浏览器（设置页）会加载 `config/` 与 `contract/`：值导入只许 `typebox` 与 nb-harness 的 `kit/shapes`，类型导入另许 nb-harness
 *   的 `kernel/contracts` 与 nb-runtime 的 `remote`；不许 `node:`、`bun` 这类平台模块。`config/` 只引用自己，`contract/` 只引用
 *   `config/` 与自己。
 * - 不取 nb-harness 的根入口与 `kernel`：它们值导出 OMP 的适配器，会把整套内核带进来。
 * - 产品代码不引用 `testing/`（测试支持只给测试）。
 * - `package.json` 的 `exports` 只列存在的文件。
 * 测试文件不受前两条限制。每条规则都带一个反例，证明规则能拦下违规。
 */

import {describe, expect, it} from "bun:test";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";

import ts from "typescript";

const SRC = import.meta.dir;
const PACKAGE_ROOT = resolve(SRC, "..");
const BROWSER_VALUE = /^(?:typebox|@notnotype\/nb-harness\/kit\/shapes)$/u;
const BROWSER_TYPE = /^(?:@notnotype\/nb-harness\/kernel\/contracts|@notnotype\/nb-runtime\/remote)$/u;
const HARNESS_HEAVY = /^@notnotype\/nb-harness(?:\/kernel)?$/u;
/** 每个浏览器侧目录能引用的包内目录。 */
const BROWSER_DIRS: Readonly<Record<string, readonly string[]>> = {config: ["config"], contract: ["config", "contract"]};

interface ImportUse {
    /** 相对 src 的路径。 */
    readonly file: string;
    readonly specifier: string;
    readonly typeOnly: boolean;
}

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return entry.name.endsWith(".ts") ? [path] : [];
    });
}

const isTest = (file: string): boolean => file.endsWith(".test.ts");

function importsOf(absolute: string): ImportUse[] {
    const source = ts.createSourceFile(absolute, readFileSync(absolute, "utf8"), ts.ScriptTarget.Latest, true);
    const file = relative(SRC, absolute);
    const uses: ImportUse[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const clause = node.importClause;
            const named = clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : null;
            const typeOnly = clause !== undefined && (clause.isTypeOnly || (clause.name === undefined && named !== null && named.length > 0 && named.every((element) => element.isTypeOnly)));
            uses.push({file, specifier: node.moduleSpecifier.text, typeOnly});
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
            const named = node.exportClause !== undefined && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : null;
            uses.push({file, specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly || (named !== null && named.length > 0 && named.every((element) => element.isTypeOnly))});
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] !== undefined && ts.isStringLiteral(node.arguments[0])) {
            uses.push({file, specifier: node.arguments[0].text, typeOnly: false});
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
            uses.push({file, specifier: node.argument.literal.text, typeOnly: true});
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return uses;
}

const top = (path: string): string => path.split("/")[0] ?? "";

function violationsOf(uses: readonly ImportUse[]): string[] {
    const found: string[] = [];
    for (const use of uses) {
        if (isTest(use.file)) continue;
        const where = `${use.file} → ${use.specifier}`;
        if (HARNESS_HEAVY.test(use.specifier) && !use.typeOnly) found.push(`不取 nb-harness 的根入口与 kernel：${where}`);
        if (use.specifier.startsWith(".") && top(use.file) !== "testing" && top(relative(SRC, resolve(SRC, dirname(use.file), use.specifier))) === "testing") found.push(`产品代码引用了测试支持：${where}`);
        const allowedDirs = BROWSER_DIRS[top(use.file)];
        if (allowedDirs === undefined) continue;
        if (use.specifier.startsWith(".")) {
            const target = top(relative(SRC, resolve(SRC, dirname(use.file), use.specifier)));
            if (!allowedDirs.includes(target)) found.push(`浏览器侧只引用 ${allowedDirs.join("、")}：${where}`);
        } else if (!BROWSER_VALUE.test(use.specifier) && !(use.typeOnly && BROWSER_TYPE.test(use.specifier))) {
            found.push(`浏览器侧的值导入只许 typebox 与 nb-harness 的 kit/shapes，类型导入另许 kernel/contracts 与 nb-runtime/remote：${where}`);
        }
    }
    return found;
}

describe("nb-models 的边界", () => {
    it("导入按运行位置与分层约定", () => {
        expect(violationsOf(sourceFiles(SRC).flatMap(importsOf))).toEqual([]);
    });

    it("exports 只列存在的文件", () => {
        const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {exports: Record<string, string>};
        expect(Object.values(manifest.exports).filter((target) => !existsSync(join(PACKAGE_ROOT, target)))).toEqual([]);
    });

    it("每条规则都能拦下对应的违规", () => {
        const use = (file: string, specifier: string, typeOnly = false): ImportUse => ({file, specifier, typeOnly});
        const cases: readonly ImportUse[] = [
            use("config/shapes.ts", "node:fs"),
            use("contract/shapes.ts", "bun"),
            use("contract/service.ts", "@notnotype/nb-harness/kernel/contracts"),
            use("contract/settings-spec.ts", "@notnotype/nb-runtime/remote"),
            use("config/rules.ts", "../contract/shapes"),
            use("contract/shapes.ts", "../core/models"),
            use("core/models.ts", "@notnotype/nb-harness"),
            use("core/models.ts", "@notnotype/nb-harness/kernel"),
            use("core/core.ts", "../testing/memory-store"),
        ];
        expect(cases.map((item) => violationsOf([item]).length)).toEqual(cases.map(() => 1));
        expect(violationsOf([
            use("config/shapes.ts", "typebox"),
            use("config/shapes.ts", "@notnotype/nb-harness/kit/shapes"),
            use("contract/service.ts", "@notnotype/nb-harness/kernel/contracts", true),
            use("contract/settings-spec.ts", "@notnotype/nb-runtime/remote", true),
            use("contract/settings-spec.ts", "../config/shapes"),
            use("core/models.ts", "@notnotype/nb-harness/models"),
            use("core/models.ts", "@notnotype/nb-harness/kernel", true),
            use("config/roles.test.ts", "typebox/value"),
            use("core/core.test.ts", "../testing/memory-store"),
            use("testing/store-contract.ts", "../core/store"),
        ])).toEqual([]);
    });
});
