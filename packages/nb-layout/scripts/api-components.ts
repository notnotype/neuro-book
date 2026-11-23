/**
 * 组件在 API 报告里的五段：props、attrs、事件、插槽、expose（w00026 t48 计划第 4 稿“API 报告”的“组件”）。
 *
 * 发布声明里组件只是 `typeof __VLS_export$N`，读不出这些，所以 props、事件、插槽、expose 取自 vue-component-meta（读源码
 * `.vue`）；它列不出模板字面量的插槽名（`panel-${string}`），也看不到属性透传落在哪，这两样读源码的宏与模板。类型一律是
 * 打印出来的文字，不取源码原文：改注释与缩进不改报告。
 */

import {readFileSync} from "node:fs";

import ts from "typescript";
import type {ComponentMeta} from "vue-component-meta";

/** 组件的五段，每段若干行；`propNames` 供与发布声明交叉核对。 */
export type ComponentSurface = {
    readonly props: readonly string[];
    readonly attrs: readonly string[];
    readonly events: readonly string[];
    readonly slots: readonly string[];
    readonly exposed: readonly string[];
    readonly propNames: readonly string[];
};

const printer = ts.createPrinter({removeComments: true, newLine: ts.NewLineKind.LineFeed});

/**
 * `meta` 是 vue-component-meta 对这个组件的结果，`file` 是它的 `.vue`，`ownSource` 判断一个声明文件是不是本包源码：
 * props 只留声明在本包里的，透传进来的 `HTMLAttributes` 那一大批由 attrs 段单独一行表示。
 */
export function componentSurface(meta: ComponentMeta, file: string, ownSource: (declarationFile: string) => boolean): ComponentSurface {
    const sfc = readFileSync(file, "utf8");
    const setup = scriptSetup(sfc);
    const props = meta.props
        .filter((prop) => !prop.global && (prop.declarations ?? []).some((declaration) => ownSource(declaration.file)))
        .sort((a, b) => byCodeUnit(a.name, b.name));
    return {
        props: props.map((prop) => `${prop.name}${prop.required ? "" : "?"}: ${prop.type}${prop.default === undefined ? "" : ` = ${prop.default}`}`),
        attrs: attrsLines(setup, sfc),
        events: meta.events.map((event) => `${event.name}(${event.type.replace(/^\[|\]$/gu, "")})`).sort(byCodeUnit),
        slots: slotLines(setup, meta),
        exposed: meta.exposed.map((item) => `${item.name}: ${item.type}`).sort(byCodeUnit),
        propNames: props.map((prop) => prop.name),
    };
}

/** 码元比较，同 `api-surface.ts`。 */
function byCodeUnit(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function scriptSetup(sfc: string): ts.SourceFile | null {
    const match = /<script\s+setup[^>]*>([\s\S]*?)<\/script>/u.exec(sfc);
    return match === null ? null : ts.createSourceFile("setup.ts", match[1]!, ts.ScriptTarget.Latest, true);
}

/** 找 `宏名<类型>()` 的类型参数（含包在 `withDefaults(...)` 里的）。 */
function macroType(setup: ts.SourceFile | null, macro: string): ts.TypeNode | null {
    let found: ts.TypeNode | null = null;
    const visit = (node: ts.Node): void => {
        if (found !== null) return;
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === macro && node.typeArguments?.length === 1) {
            found = node.typeArguments[0]!;
            return;
        }
        ts.forEachChild(node, visit);
    };
    if (setup !== null) visit(setup);
    return found;
}

function print(node: ts.Node): string {
    return printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile()).replace(/\s+/gu, " ").trim();
}

/**
 * 属性透传：`defineProps` 的类型参数里与包外类型（从 `vue` 这类非相对路径导入的）做交叉的那几项，加上属性落在哪个元素。
 * `inheritAttrs: false` 时看模板里 `v-bind="$attrs"`（或 `useAttrs()` 的变量）所在元素的标签名。
 */
function attrsLines(setup: ts.SourceFile | null, sfc: string): string[] {
    const lines: string[] = [];
    const propsType = macroType(setup, "defineProps");
    if (propsType !== null && setup !== null && ts.isIntersectionTypeNode(propsType)) {
        const external = externalImports(setup);
        for (const member of propsType.types) {
            if (referencesAny(member, external)) lines.push(`& ${print(member)}`);
        }
    }
    // `defineOptions({inheritAttrs: false})` 与非 setup 的 `<script>` 里 `export default {inheritAttrs: false}` 都算。
    if (!/inheritAttrs:\s*false/u.test(sfc)) {
        lines.push("→ 根元素");
    } else {
        const variable = /const\s+(\w+)\s*=\s*useAttrs\(\)/u.exec(sfc)?.[1];
        // 属性值里可能有 `>`（`v-if="a > 0"`），按引号跳过整段值，不按第一个 `>` 截断标签。
        const bound = new RegExp(`<([\\w-]+)\\b(?:[^>"']|"[^"]*"|'[^']*')*?\\sv-bind="(?:\\$attrs${variable === undefined ? "" : `|${variable}`})"`, "u").exec(sfc);
        lines.push(bound === null ? "→ 不落（inheritAttrs: false）" : `→ <${bound[1]}>（inheritAttrs: false）`);
    }
    return lines;
}

function externalImports(setup: ts.SourceFile): Set<string> {
    const names = new Set<string>();
    for (const statement of setup.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text.startsWith(".")) continue;
        const bindings = statement.importClause?.namedBindings;
        if (bindings !== undefined && ts.isNamedImports(bindings)) for (const element of bindings.elements) names.add(element.name.text);
    }
    return names;
}

function rootName(name: ts.EntityName): string {
    return ts.isIdentifier(name) ? name.text : rootName(name.left);
}

/** 这一项里有没有引到包外导入的类型：`HTMLAttributes` 本身，或包在 `Pick<HTMLAttributes, "id">` 这类工具类型里。 */
function referencesAny(node: ts.Node, names: ReadonlySet<string>): boolean {
    if (ts.isTypeReferenceNode(node) && names.has(rootName(node.typeName))) return true;
    return ts.forEachChild(node, (child) => referencesAny(child, names) || undefined) ?? false;
}

/** 有 `defineSlots` 时打印它的类型参数（覆盖模板字面量名字），没有时用 vue-component-meta 从模板推出的插槽。 */
function slotLines(setup: ts.SourceFile | null, meta: ComponentMeta): string[] {
    const declared = macroType(setup, "defineSlots");
    if (declared !== null) {
        if (ts.isTypeLiteralNode(declared)) return declared.members.map(print).map((line) => line.replace(/;$/u, "")).sort(byCodeUnit);
        return [print(declared)];
    }
    return meta.slots.map((slot) => `${slot.name}: ${slot.type}`).sort(byCodeUnit);
}
