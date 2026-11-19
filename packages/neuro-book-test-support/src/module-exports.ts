/**
 * 读一个模块文件里写出的导出：入口与 SDK 的导出面测试用（nb-layout 的 `exports.test.ts`、应用的 `sdk/sdk.test.ts`）。只解析语法树，
 * 不建程序、不做类型检查（单文件组件 Bun 加载不了，类型检查又太慢）；所以只认得写在这个文件里的导出，经 `export *` 带出去的名字
 * 看不到，调用方要另外拦 `export *`。
 */

import ts from "typescript";

export interface ModuleExport {
    readonly name: string;
    /** `export … from "<来源>"` 的来源；就地声明的为空串。 */
    readonly from: string;
    readonly kind: "value" | "type";
}

/** 模块里的导出：具名再导出（`export {a, type B} from`、`export type {C} from`）与就地声明（`export const`、`export function`、`export type X =`……）。 */
export function moduleExports(text: string): ModuleExport[] {
    const source = ts.createSourceFile("module.ts", text, ts.ScriptTarget.Latest);
    return source.statements.flatMap((statement): ModuleExport[] => {
        if (ts.isExportDeclaration(statement)) {
            if (statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause)) return [];
            const from = statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : "";
            return statement.exportClause.elements.map((element) => ({name: element.name.text, from, kind: statement.isTypeOnly || element.isTypeOnly ? "type" : "value"}));
        }
        if (!ts.canHaveModifiers(statement) || !(ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return [];
        if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) return [{name: statement.name.text, from: "", kind: "type"}];
        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name !== undefined) return [{name: statement.name.text, from: "", kind: "value"}];
        if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((declaration) => (ts.isIdentifier(declaration.name) ? [{name: declaration.name.text, from: "", kind: "value" as const}] : []));
        return [];
    });
}

/** 模块里有没有 `export * from` 或 `export * as`：有的话 `moduleExports` 看不全。 */
export function hasStarExport(text: string): boolean {
    const source = ts.createSourceFile("module.ts", text, ts.ScriptTarget.Latest);
    return source.statements.some((statement) => ts.isExportDeclaration(statement) && (statement.exportClause === undefined || ts.isNamespaceExport(statement.exportClause)));
}

/** 模块里有没有默认导出（`export default`、`export {x as default}`）。 */
export function hasDefaultExport(text: string): boolean {
    const source = ts.createSourceFile("module.ts", text, ts.ScriptTarget.Latest);
    return source.statements.some((statement) => ts.isExportAssignment(statement)) || moduleExports(text).some((item) => item.name === "default");
}
