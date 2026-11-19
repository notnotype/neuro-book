/**
 * 读一个模块文件里写出的导出：入口与 SDK 的导出面测试用（nb-layout 的 `exports.test.ts`、应用的 `sdk/sdk.test.ts`）。只解析语法树，
 * 不建程序、不做类型检查（单文件组件 Bun 加载不了，类型检查又太慢）；所以只认得写在这个文件里的导出，经 `export *` 带出去的名字
 * 看不到，调用方要另外拦 `export *`。遇到认不出名字的导出写法（解构、命名空间、`export import`）直接抛错，不静默漏掉。
 */

import ts from "typescript";

export interface ModuleExport {
    readonly name: string;
    /** `export … from "<来源>"` 的来源；就地声明的为空串。 */
    readonly from: string;
    readonly kind: "value" | "type";
    /** 名字所在的行（从 1 起）。 */
    readonly line: number;
}

const parse = (text: string): ts.SourceFile => ts.createSourceFile("module.ts", text, ts.ScriptTarget.Latest, true);

const hasModifier = (statement: ts.Statement, kind: ts.SyntaxKind): boolean => ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === kind);

/**
 * 模块里的导出：具名再导出（`export {a, type B} from`、`export type {C} from`）与就地声明（`export const`、`export function`、
 * `export type X =`……）。同名的重载只算一个；默认导出（`export default …`）不在这里，见 `hasDefaultExport`。
 */
export function moduleExports(text: string): ModuleExport[] {
    const source = parse(text);
    const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const found = source.statements.flatMap((statement): ModuleExport[] => {
        if (ts.isExportDeclaration(statement)) {
            if (statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause)) return [];
            const from = statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : "";
            return statement.exportClause.elements.map((element) => ({name: element.name.text, from, kind: statement.isTypeOnly || element.isTypeOnly ? "type" : "value", line: lineOf(element)}));
        }
        if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword) || hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) return [];
        if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) return [{name: statement.name.text, from: "", kind: "type", line: lineOf(statement.name)}];
        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name !== undefined) return [{name: statement.name.text, from: "", kind: "value", line: lineOf(statement.name)}];
        if (ts.isVariableStatement(statement)) {
            return statement.declarationList.declarations.map((declaration) => {
                if (!ts.isIdentifier(declaration.name)) throw new Error(`认不出解构导出的名字：第 ${String(lineOf(declaration))} 行`);
                return {name: declaration.name.text, from: "", kind: "value" as const, line: lineOf(declaration.name)};
            });
        }
        throw new Error(`认不出这种导出写法（命名空间、export import 一类）：第 ${String(lineOf(statement))} 行`);
    });
    const seen = new Set<string>();
    return found.filter((item) => {
        const key = `${item.kind}\u0000${item.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** 模块里有没有 `export * from` 或 `export * as`：有的话 `moduleExports` 看不全。 */
export function hasStarExport(text: string): boolean {
    return parse(text).statements.some((statement) => ts.isExportDeclaration(statement) && (statement.exportClause === undefined || ts.isNamespaceExport(statement.exportClause)));
}

/** 模块里有没有默认导出：`export default 表达式`、`export default function/class`（有名无名都算）、`export {x as default}`。 */
export function hasDefaultExport(text: string): boolean {
    const statements = parse(text).statements;
    return statements.some((statement) => ts.isExportAssignment(statement) || (hasModifier(statement, ts.SyntaxKind.ExportKeyword) && hasModifier(statement, ts.SyntaxKind.DefaultKeyword)))
        || moduleExports(text).some((item) => item.name === "default");
}
