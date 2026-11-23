/**
 * 包的依赖边界（AGENTS.md“边界”）：核心不依赖任何包，这样插件激活时就能建模型、Bun 里也能测；Vue 层只依赖 `vue`、
 * `tabbable` 与核心，不依赖 nb-ui（主题经 CSS 变量、文字经 `./text` 的注入点取，ADR 0054 第 3 条）。新增文件同样受约束。扫描的写法与它的取舍见 `@notnotype/neuro-book-test-support/import-boundary`。
 */

import {describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";
import {join, relative} from "node:path";

import ts from "typescript";

import {scanImports, sourceFiles, type ImportRule} from "@notnotype/neuro-book-test-support/import-boundary";

const SOURCE_ROOT = import.meta.dir;
const VUE_ROOT = join(SOURCE_ROOT, "vue");

const CORE: ImportRule = {packages: [], within: SOURCE_ROOT};
const VUE: ImportRule = {packages: [/^vue$/u, /^tabbable$/u], within: SOURCE_ROOT};

describe("包的导入", () => {
    it("核心只导入自己的文件", () => {
        expect(scanImports(sourceFiles(SOURCE_ROOT, new Set(["vue"])), CORE)).toEqual([]);
    });

    it("Vue 层只导入 vue、tabbable 与本包的文件", () => {
        expect(scanImports(sourceFiles(VUE_ROOT), VUE)).toEqual([]);
    });
});

/** 去掉块注释、整行或行尾的 `//` 注释（前面是空白时才算，网址里的 `//` 不动）与 HTML 注释；宁可误报，命中了再看。 */
function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/<!--[\s\S]*?-->/gu, " ").replace(/(^|\s)\/\/.*$/gmu, "$1");
}

/** 持久化与网络入口：docs/specs/ui/layout-drag.md、ui/nested-grid.md 的“副作用与数据”说状态只在内存里。 */
const PERSISTENCE = /\bfetch\s*\(|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b|\.cookie\b|\bcaches\b/gu;

function persistenceUses(files: ReadonlyArray<string>): string[] {
    return files.flatMap((file) => [...stripComments(readFileSync(file, "utf8")).matchAll(PERSISTENCE)].map((match) => `${relative(SOURCE_ROOT, file)}: ${match[0]}`));
}

const DOM_GLOBALS: ReadonlySet<string> = new Set(["window", "document"]);

/** 一个声明里绑定的名字（含解构）。 */
function bindingNames(name: ts.BindingName): string[] {
    if (ts.isIdentifier(name)) return [name.text];
    return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : bindingNames(element.name)));
}

/** `scope` 自己声明的名字：参数、语句里的变量、函数与类、for 的变量、catch 的变量。只看直接一层，嵌套的由向上走时各自查。 */
function declaredIn(scope: ts.Node): string[] {
    const names: string[] = [];
    if (ts.isFunctionLike(scope)) names.push(...scope.parameters.flatMap((parameter) => bindingNames(parameter.name)));
    if (ts.isCatchClause(scope) && scope.variableDeclaration !== undefined) names.push(...bindingNames(scope.variableDeclaration.name));
    if ((ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope)) && scope.initializer !== undefined && ts.isVariableDeclarationList(scope.initializer)) {
        names.push(...scope.initializer.declarations.flatMap((declaration) => bindingNames(declaration.name)));
    }
    if (ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope) || ts.isCaseClause(scope) || ts.isDefaultClause(scope)) {
        for (const statement of scope.statements) {
            if (ts.isVariableStatement(statement)) names.push(...statement.declarationList.declarations.flatMap((declaration) => bindingNames(declaration.name)));
            else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name !== undefined) names.push(statement.name.text);
            else if (ts.isImportDeclaration(statement) && statement.importClause !== undefined) {
                const {name, namedBindings} = statement.importClause;
                if (name !== undefined) names.push(name.text);
                if (namedBindings !== undefined) names.push(...(ts.isNamespaceImport(namedBindings) ? [namedBindings.name.text] : namedBindings.elements.map((element) => element.name.text)));
            }
        }
    }
    return names;
}

/** 这个标识符不是对变量的引用：属性名、声明出来的名字、导入导出的名字。 */
function isNotReference(node: ts.Identifier): boolean {
    const {parent} = node;
    if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
    if (ts.isQualifiedName(parent)) return parent.right === node;
    if (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent) || ts.isGetAccessor(parent) || ts.isSetAccessor(parent) || ts.isEnumMember(parent)) return parent.name === node;
    if (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent)) return parent.name === node;
    if (ts.isBindingElement(parent)) return parent.name === node || parent.propertyName === node;
    return ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent);
}

/**
 * 对全局 `window`、`document` 的引用（含 `globalThis.window` 这种写法）：解析成语法树，跳过属性名与本地声明的同名变量
 * （`grid-swap.ts` 的裁切窗就叫 `window`）。注释与字符串不是标识符，自然不算。
 */
function domGlobalUses(files: ReadonlyArray<string>): string[] {
    return files.flatMap((file) => {
        const text = readFileSync(file, "utf8");
        // 只解析文字里出现这两个词的文件：整包都解析要两百多毫秒，超出快速测试的预算。
        if (!/\b(?:window|document)\b/u.test(text)) return [];
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        const uses: string[] = [];
        const at = (node: ts.Node, name: string) => uses.push(`${relative(SOURCE_ROOT, file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${name}`);
        const visit = (node: ts.Node): void => {
            if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "globalThis" && DOM_GLOBALS.has(node.name.text)) at(node, `globalThis.${node.name.text}`);
            if (ts.isIdentifier(node) && DOM_GLOBALS.has(node.text) && !isNotReference(node)) {
                let scope: ts.Node | undefined = node.parent;
                while (scope !== undefined && !declaredIn(scope).includes(node.text)) scope = scope.parent;
                if (scope === undefined) at(node, node.text);
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
        return uses;
    });
}

describe("副作用与环境", () => {
    it("核心与 Vue 层不发网络请求（fetch、XMLHttpRequest、WebSocket、EventSource、sendBeacon），不碰 localStorage、sessionStorage、indexedDB、cookie、caches（副作用与数据：只在内存里）", () => {
        expect(persistenceUses(sourceFiles(SOURCE_ROOT))).toEqual([]);
    });

    it("核心不引用全局 window、document（layout-drag 输入：纯 TS）", () => {
        const core = sourceFiles(SOURCE_ROOT, new Set(["vue"]));
        expect(core.filter((file) => !file.endsWith(".ts"))).toEqual([]);
        expect(domGlobalUses(core)).toEqual([]);
    });
});
