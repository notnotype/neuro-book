/**
 * nb-host 的边界（ADR 0045）：
 * - 与应用无关：非测试源码（含注释）不写应用名，不导入应用包；应用名、产品名、插件 id 都由宿主传入。
 * - 浏览器会加载 `web/` 与 `shared/`：它们导入的包只许 nb-runtime 的子路径与 TypeBox；新加第三方依赖要同时加进应用
 *   `vite.config.ts` 的 `optimizeDeps.include`，否则开发模式的页面会在运行中重新预构建、整页重载。
 * - `shared/http-contracts.ts` 是路由合同，没有任何运行时导入。
 * - 服务端（`server/`、`http/`）与浏览器（`web/`）互不引用；`shared/` 不引用任何一侧。
 * - 内核的 `createApplication` 只由两个宿主适配器导入（`web/browser-host.ts`、`server/host.ts`）：它们负责把平台档案放进清单。
 * - `package.json` 的 `exports` 只列存在的文件。
 * 测试文件不受浏览器侧白名单、两侧互不引用与 `createApplication` 三条限制：它们要在同一进程里起真实的服务端。
 * 每条规则都带一个反例，证明规则能拦下违规。
 */

import {describe, expect, it} from "bun:test";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";

import ts from "typescript";

const SRC = import.meta.dir;
const PACKAGE_ROOT = resolve(SRC, "..");
/** 现有的应用名：NeuroBook 与 NeuroBot。 */
/** `nbot` 前后不能是字母：`drainBoth` 这类单词内部的“nBot”不算。 */
const APP_NAMES = /nbook|neurobook|neurobot|(?<![a-z])nbot(?![a-z])/iu;
/** 应用包本身；`@notnotype/neuro-book-test-support` 不是应用包。 */
const APP_PACKAGES = /^(?:nbook\/|@notnotype\/neuro-book(?:\/|$)|@notnotype\/neuro-bot(?:\/|$))/u;
const BROWSER_PACKAGES = /^(?:@notnotype\/nb-runtime\/[a-z-]+|typebox)$/u;
const KERNEL_CREATE_USERS = ["web/browser-host.ts", "server/host.ts"];

interface ImportUse {
    /** 相对 src 的路径。 */
    readonly file: string;
    readonly specifier: string;
    readonly typeOnly: boolean;
    /** 导入的名字；默认导入、命名空间导入或副作用导入为 null。 */
    readonly names: readonly string[] | null;
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
            const names = clause === undefined || clause.name !== undefined || named === null ? null : named.map((element) => (element.propertyName ?? element.name).text);
            uses.push({file, specifier: node.moduleSpecifier.text, typeOnly, names});
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
            const named = node.exportClause !== undefined && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : null;
            const typeOnly = node.isTypeOnly || (named !== null && named.length > 0 && named.every((element) => element.isTypeOnly));
            uses.push({file, specifier: node.moduleSpecifier.text, typeOnly, names: named === null ? null : named.map((element) => (element.propertyName ?? element.name).text)});
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] !== undefined && ts.isStringLiteral(node.arguments[0])) {
            uses.push({file, specifier: node.arguments[0].text, typeOnly: false, names: null});
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
            uses.push({file, specifier: node.argument.literal.text, typeOnly: true, names: null});
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return uses;
}

/** 相对导入在 src 内的目标（相对 src）；包名为 null。 */
const targetOf = (use: ImportUse): string | null => (use.specifier.startsWith(".") ? relative(SRC, resolve(SRC, dirname(use.file), use.specifier)) : null);
const top = (path: string): string => path.split("/")[0] ?? "";

function violationsOf(uses: readonly ImportUse[]): string[] {
    const found: string[] = [];
    for (const use of uses) {
        const where = `${use.file} → ${use.specifier}`;
        const from = top(use.file);
        const target = targetOf(use);
        if (APP_PACKAGES.test(use.specifier)) found.push(`导入了应用包：${where}`);
        const browser = from === "web" || from === "shared";
        if (browser && !isTest(use.file) && target === null && !BROWSER_PACKAGES.test(use.specifier)) {
            found.push(`浏览器侧只许导入 nb-runtime 的子路径与 typebox（新加第三方依赖要同时加进应用 vite.config.ts 的 optimizeDeps.include）：${where}`);
        }
        if (use.file === "shared/http-contracts.ts" && !use.typeOnly) found.push(`路由合同不许有运行时导入：${where}`);
        if (target !== null && !isTest(use.file)) {
            if ((from === "server" || from === "http") && top(target) === "web") found.push(`服务端引用了浏览器侧：${where}`);
            if (browser && (top(target) === "server" || top(target) === "http")) found.push(`浏览器侧或共用代码引用了服务端：${where}`);
            if (from === "shared" && top(target) === "web") found.push(`共用代码引用了浏览器侧：${where}`);
        }
        if (use.specifier === "@notnotype/nb-runtime/application" && !use.typeOnly && (use.names === null || use.names.includes("createApplication")) && !KERNEL_CREATE_USERS.includes(use.file) && !isTest(use.file)) {
            found.push(`内核的 createApplication 只由两个宿主适配器导入：${where}`);
        }
    }
    return found;
}

function appNameLines(file: string): string[] {
    return readFileSync(file, "utf8").split("\n").flatMap((line, index) => (APP_NAMES.test(line) ? [`${relative(SRC, file)}:${String(index + 1)}：${line.trim()}`] : []));
}

describe("nb-host 的边界", () => {
    const files = sourceFiles(SRC);

    it("非测试源码（含注释）不出现应用名", () => {
        expect(files.filter((file) => !isTest(file)).flatMap(appNameLines)).toEqual([]);
    });

    it("导入按运行位置与分层约定", () => {
        expect(violationsOf(files.flatMap(importsOf))).toEqual([]);
    });

    it("exports 只列存在的文件", () => {
        const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {exports: Record<string, string>};
        expect(Object.values(manifest.exports).filter((target) => !existsSync(join(PACKAGE_ROOT, target)))).toEqual([]);
    });

    it("每条规则都能拦下对应的违规", () => {
        for (const name of ["NeuroBook", "nbook", "NeuroBot", "nbot"]) expect(APP_NAMES.test(`const id = "${name}";`)).toBe(true);
        for (const name of ["nbot.memory", "NBOT_HOME"]) expect(APP_NAMES.test(name)).toBe(true);
        expect(APP_NAMES.test("const drained = drainBoth();")).toBe(false);
        const use = (file: string, specifier: string, typeOnly = false, names: readonly string[] | null = null): ImportUse => ({file, specifier, typeOnly, names});
        const cases: readonly ImportUse[] = [
            use("server/start.ts", "nbook/server/config"),
            use("server/start.ts", "@notnotype/neuro-book/manifest"),
            use("server/start.ts", "@notnotype/neuro-bot/server"),
            use("web/remote-session.ts", "hono"),
            use("shared/socket.ts", "node:net"),
            use("shared/http-contracts.ts", "@notnotype/nb-runtime/plugins"),
            use("server/start.ts", "../web/browser-host"),
            use("http/plugin.ts", "../web/remote-session"),
            use("web/remote-session.ts", "../server/host"),
            use("shared/socket.ts", "../http/dispatch"),
            use("shared/socket.ts", "../web/rpc-socket"),
            use("server/start.ts", "@notnotype/nb-runtime/application", false, ["createApplication"]),
        ];
        expect(cases.map((item) => violationsOf([item]).length)).toEqual(cases.map(() => 1));
        expect(violationsOf([
            use("web/remote-session.ts", "@notnotype/nb-runtime/remote"),
            use("web/remote-session.ts", "../shared/socket"),
            use("shared/http-contracts.ts", "@notnotype/nb-runtime/plugins", true),
            use("server/host.ts", "@notnotype/nb-runtime/application", false, ["createApplication"]),
            use("server/start.ts", "@notnotype/nb-runtime/application", true, ["Application"]),
            use("server/start.ts", "hono"),
            use("web/remote-session.test.ts", "../server/start"),
            use("server/start.test.ts", "@notnotype/neuro-book-test-support/tmp"),
        ])).toEqual([]);
    });
});
