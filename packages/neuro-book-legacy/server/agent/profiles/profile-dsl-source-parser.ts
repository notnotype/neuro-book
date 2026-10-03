import {createRequire} from "node:module";
import type * as TypeScript from "typescript";
import type {
    ProfileTemplateNodeDto,
    ProfileTemplateNodeType,
    ProfileTemplatePropValue,
    ProfileTemplateTextKind,
} from "nbook/shared/dto/profile-template.dto";

const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof TypeScript;

const PROFILE_DSL_COMPONENTS = new Set<ProfileTemplateNodeType>([
    "ProfilePrompt",
    "System",
    "HistorySet",
    "ModelContext",
    "AppendingSet",
    "FileChangeNotice",
    "Message",
    "AIMessage",
    "ToolCall",
    "ToolResult",
    "Reminder",
    "Watch",
    "If",
    "SystemReminder",
    "LinkedAgentsSummary",
    "LinkedAgentsReminder",
    "WorkspaceFocusReminder",
    "ModeAvailabilityReminder",
    "TaskReminder",
    "ModeReminder",
    "ModeSlot",
    "MentionedSkillsReminder",
    "AgentCatalog",
    "SkillCatalog",
    "WorkflowCatalog",
    "ActivatedSkills",
    "SqlSchemaSummary",
    "Import",
]);

type ParseContext = {
    jsxBindings: Map<string, TypeScript.Expression>;
};

/**
 * 从 profile 源码中解析稳定的 TSX DSL 树。复杂 TypeScript 保留为 source 文本节点。
 */
export function buildProfilePromptRoot(source: string): ProfileTemplateNodeDto | null {
    const sourceFile = ts.createSourceFile("profile.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const rootExpression = findContextProfilePromptExpression(sourceFile);
    if (!rootExpression) {
        return null;
    }
    return parseExpression(sourceFile, rootExpression.expression, {
        jsxBindings: collectJsxBindings(sourceFile, rootExpression.scope),
    });
}

/**
 * 查找 defineAgentProfile({ context() { return <ProfilePrompt /> } }) 的返回表达式。
 */
function findContextProfilePromptExpression(sourceFile: TypeScript.SourceFile): {expression: TypeScript.Expression; scope: TypeScript.Node} | null {
    const contexts: TypeScript.Node[] = [];
    const visit = (node: TypeScript.Node): void => {
        if (isContextMethod(node, sourceFile)) {
            contexts.push(readContextBodyNode(node));
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    for (const contextNode of contexts) {
        const returned = findReturnedProfilePrompt(contextNode, sourceFile);
        if (returned) {
            return {
                expression: returned,
                scope: contextNode,
            };
        }
        const expression = readExpressionBody(contextNode);
        if (expression && isProfilePromptExpression(expression, sourceFile)) {
            return {
                expression,
                scope: contextNode,
            };
        }
    }
    const fallback = findReturnedProfilePrompt(sourceFile, sourceFile);
    return fallback ? {expression: fallback, scope: sourceFile} : null;
}

/**
 * 判断 AST 节点是否是 object literal 里的 context 入口。
 */
function isContextMethod(node: TypeScript.Node, sourceFile: TypeScript.SourceFile): boolean {
    if (ts.isMethodDeclaration(node)) {
        return node.name.getText(sourceFile) === "context";
    }
    if (ts.isPropertyAssignment(node)) {
        return node.name.getText(sourceFile) === "context";
    }
    return false;
}

/**
 * 读取 context 入口可扫描的函数体或表达式。
 */
function readContextBodyNode(node: TypeScript.Node): TypeScript.Node {
    if (ts.isMethodDeclaration(node) && node.body) {
        return node.body;
    }
    if (ts.isPropertyAssignment(node)) {
        return node.initializer;
    }
    return node;
}

/**
 * 读取 arrow function 的表达式体。
 */
function readExpressionBody(node: TypeScript.Node): TypeScript.Expression | null {
    if (ts.isArrowFunction(node) && node.body && !ts.isBlock(node.body)) {
        return unwrapParenthesized(node.body);
    }
    if (ts.isPropertyAssignment(node) && ts.isArrowFunction(node.initializer) && !ts.isBlock(node.initializer.body)) {
        return unwrapParenthesized(node.initializer.body);
    }
    return null;
}

/**
 * 在指定作用域中查找 return <ProfilePrompt>。
 */
function findReturnedProfilePrompt(root: TypeScript.Node, sourceFile: TypeScript.SourceFile): TypeScript.Expression | null {
    let found: TypeScript.Expression | null = null;
    const visit = (node: TypeScript.Node): void => {
        if (found) {
            return;
        }
        if (node !== root && isNestedFunctionLike(node)) {
            return;
        }
        if (ts.isReturnStatement(node) && node.expression) {
            const expression = unwrapParenthesized(node.expression);
            if (isProfilePromptExpression(expression, sourceFile)) {
                found = expression;
            }
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(root);
    return found;
}

/**
 * 收集当前 context 作用域内的 JSX 局部绑定，用于解析 `{someJsx}`。
 */
function collectJsxBindings(sourceFile: TypeScript.SourceFile, scope: TypeScript.Node): Map<string, TypeScript.Expression> {
    const bindings = new Map<string, TypeScript.Expression>();
    const visit = (node: TypeScript.Node): void => {
        if (node !== scope && isNestedFunctionLike(node)) {
            return;
        }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            const initializer = unwrapParenthesized(node.initializer);
            if (isJsxExpression(initializer)) {
                bindings.set(node.name.getText(sourceFile), initializer);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(scope);
    return bindings;
}

/**
 * 解析任意 JSX 表达式为低代码节点。
 */
function parseExpression(
    sourceFile: TypeScript.SourceFile,
    expression: TypeScript.Expression,
    context: ParseContext,
): ProfileTemplateNodeDto | null {
    const current = unwrapParenthesized(expression);
    if (ts.isJsxElement(current)) {
        return parseJsxElement(sourceFile, current, context);
    }
    if (ts.isJsxSelfClosingElement(current)) {
        return parseSelfClosingElement(sourceFile, current);
    }
    if (ts.isIdentifier(current)) {
        const bound = context.jsxBindings.get(current.getText(sourceFile));
        return bound ? parseExpression(sourceFile, bound, context) : null;
    }
    return null;
}

/**
 * 解析普通 JSX element。
 */
function parseJsxElement(
    sourceFile: TypeScript.SourceFile,
    element: TypeScript.JsxElement,
    context: ParseContext,
): ProfileTemplateNodeDto | null {
    const type = element.openingElement.tagName.getText(sourceFile);
    if (!isComponentType(type)) {
        return createTextNode(element.getText(sourceFile), "source", element.getStart(sourceFile), element.getEnd());
    }
    const node: ProfileTemplateNodeDto = {
        id: createNodeId(type, element.getStart(sourceFile)),
        type,
        props: parseAttributes(sourceFile, element.openingElement.attributes),
        children: parseChildren(sourceFile, element.children, context),
        editable: true,
        sourceRange: {
            start: element.getStart(sourceFile),
            end: element.getEnd(),
        },
    };
    hydrateToolCallText(node);
    return node;
}

/**
 * 解析自闭合 JSX element。
 */
function parseSelfClosingElement(
    sourceFile: TypeScript.SourceFile,
    element: TypeScript.JsxSelfClosingElement,
): ProfileTemplateNodeDto | null {
    const type = element.tagName.getText(sourceFile);
    if (!isComponentType(type)) {
        return createTextNode(element.getText(sourceFile), "source", element.getStart(sourceFile), element.getEnd());
    }
    const node: ProfileTemplateNodeDto = {
        id: createNodeId(type, element.getStart(sourceFile)),
        type,
        props: parseAttributes(sourceFile, element.attributes),
        children: [],
        editable: true,
        sourceRange: {
            start: element.getStart(sourceFile),
            end: element.getEnd(),
        },
    };
    hydrateToolCallText(node);
    return node;
}

/**
 * 解析 JSX children，普通文本变成 Text 节点，表达式尽量保留源码。
 */
function parseChildren(
    sourceFile: TypeScript.SourceFile,
    children: TypeScript.NodeArray<TypeScript.JsxChild>,
    context: ParseContext,
): ProfileTemplateNodeDto[] {
    const result: ProfileTemplateNodeDto[] = [];
    let pendingText = "";
    let pendingKind: ProfileTemplateTextKind = "text";
    const flushText = (end: number): void => {
        const normalized = pendingKind === "text" ? normalizeText(pendingText) : pendingText;
        if (normalized.trim()) {
            result.push(createTextNode(normalized, pendingKind, end - pendingText.length, end));
        }
        pendingText = "";
        pendingKind = "text";
    };
    const appendText = (text: string, kind: ProfileTemplateTextKind): void => {
        if (!text) {
            return;
        }
        if (pendingText && pendingKind !== kind) {
            flushText(children.pos);
        }
        pendingKind = kind;
        pendingText += text;
    };
    for (const child of children) {
        if (ts.isJsxText(child)) {
            appendText(decodeJsxTextEntities(sourceFile.text.slice(child.pos, child.end).replace(/\r\n/g, "\n")), "text");
            continue;
        }
        flushText(child.getStart(sourceFile));
        if (ts.isJsxExpression(child) && child.expression) {
            result.push(...parseJsxChildExpression(sourceFile, child.expression, context, child.getStart(sourceFile), child.getEnd()));
            continue;
        }
        if (ts.isJsxElement(child)) {
            const node = parseJsxElement(sourceFile, child, context);
            if (node) {
                result.push(node);
            }
            continue;
        }
        if (ts.isJsxSelfClosingElement(child)) {
            const node = parseSelfClosingElement(sourceFile, child);
            if (node) {
                result.push(node);
            }
        }
    }
    flushText(children.end);
    return mergeAdjacentTextNodes(result);
}

/**
 * 解析 `{...}` 形式的 JSX child。
 */
function parseJsxChildExpression(
    sourceFile: TypeScript.SourceFile,
    expression: TypeScript.Expression,
    context: ParseContext,
    start: number,
    end: number,
): ProfileTemplateNodeDto[] {
    const current = unwrapParenthesized(expression);
    if (isJsxExpression(current)) {
        const node = parseExpression(sourceFile, current, context);
        return node ? [node] : [];
    }
    if (ts.isJsxFragment(current)) {
        return parseChildren(sourceFile, current.children, context);
    }
    if (ts.isIdentifier(current)) {
        const bound = context.jsxBindings.get(current.getText(sourceFile));
        if (bound) {
            const node = parseExpression(sourceFile, bound, context);
            return node ? [node] : [];
        }
    }
    if (ts.isConditionalExpression(current)) {
        return [parseConditionalExpression(sourceFile, current, context)];
    }
    if (current.kind === ts.SyntaxKind.NullKeyword || current.kind === ts.SyntaxKind.FalseKeyword || current.kind === ts.SyntaxKind.TrueKeyword) {
        return [];
    }
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
        return [createTextNode(current.text, "text", start, end)];
    }
    return [createTextNode(current.getText(sourceFile), "source", start, end)];
}

/**
 * 将常见 `condition ? <Node /> : null` 映射为 If 节点。
 */
function parseConditionalExpression(
    sourceFile: TypeScript.SourceFile,
    expression: TypeScript.ConditionalExpression,
    context: ParseContext,
): ProfileTemplateNodeDto {
    return {
        id: createNodeId("If", expression.getStart(sourceFile)),
        type: "If",
        props: {
            condition: {
                kind: "expression",
                code: expression.condition.getText(sourceFile),
            },
        },
        children: parseConditionalBranch(sourceFile, expression.whenTrue, context),
        editable: true,
        sourceRange: {
            start: expression.getStart(sourceFile),
            end: expression.getEnd(),
        },
    };
}

/**
 * 解析条件分支中的 JSX 或表达式源码。
 */
function parseConditionalBranch(
    sourceFile: TypeScript.SourceFile,
    expression: TypeScript.Expression,
    context: ParseContext,
): ProfileTemplateNodeDto[] {
    const current = unwrapParenthesized(expression);
    if (isJsxExpression(current)) {
        const node = parseExpression(sourceFile, current, context);
        return node ? [node] : [];
    }
    if (ts.isJsxFragment(current)) {
        return parseChildren(sourceFile, current.children, context);
    }
    if (current.kind === ts.SyntaxKind.NullKeyword || current.kind === ts.SyntaxKind.FalseKeyword) {
        return [];
    }
    return [createTextNode(current.getText(sourceFile), "source", current.getStart(sourceFile), current.getEnd())];
}

/**
 * 解析 JSX attributes 为 DTO 属性。
 */
function parseAttributes(
    sourceFile: TypeScript.SourceFile,
    attributes: TypeScript.JsxAttributes,
): Record<string, ProfileTemplatePropValue> {
    const props: Record<string, ProfileTemplatePropValue> = {};
    for (const property of attributes.properties) {
        if (!ts.isJsxAttribute(property)) {
            continue;
        }
        const name = property.name.getText(sourceFile);
        if (!property.initializer) {
            props[name] = true;
            continue;
        }
        if (ts.isStringLiteral(property.initializer)) {
            props[name] = property.initializer.text;
            continue;
        }
        if (ts.isJsxExpression(property.initializer) && property.initializer.expression) {
            props[name] = parsePropExpression(sourceFile, property.initializer.expression);
        }
    }
    return props;
}

/**
 * ToolCall 运行时参数是 args prop；画布沿用正文 JSON 编辑区，因此解析时把 args 表达式放回 text。
 */
function hydrateToolCallText(node: ProfileTemplateNodeDto): void {
    if (node.type !== "ToolCall" || !node.props.args) {
        return;
    }
    const args = node.props.args;
    node.text = typeof args === "object" && args !== null && "kind" in args && args.kind === "expression"
        ? args.code
        : JSON.stringify(args, null, 2);
    node.textKind = typeof args === "object" && args !== null && "kind" in args ? "source" : "text";
    delete node.props.args;
}

/**
 * 解析属性表达式，复杂值保留为源码表达式。
 */
function parsePropExpression(sourceFile: TypeScript.SourceFile, expression: TypeScript.Expression): ProfileTemplatePropValue {
    if (expression.kind === ts.SyntaxKind.TrueKeyword) {
        return true;
    }
    if (expression.kind === ts.SyntaxKind.FalseKeyword) {
        return false;
    }
    if (expression.kind === ts.SyntaxKind.NullKeyword) {
        return null;
    }
    if (ts.isNumericLiteral(expression)) {
        return Number(expression.text);
    }
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        return expression.text;
    }
    return {
        kind: "expression",
        code: expression.getText(sourceFile),
    };
}

/**
 * 创建可视化文本节点。
 */
function createTextNode(text: string, textKind: ProfileTemplateTextKind, start: number, end: number): ProfileTemplateNodeDto {
    return {
        id: createNodeId("Text", Math.max(0, start)),
        type: "Text",
        props: {},
        children: [],
        text,
        textKind,
        editable: true,
        sourceRange: {
            start: Math.max(0, start),
            end: Math.max(Math.max(0, start), end),
        },
    };
}

/**
 * 合并相邻普通文本节点，降低画布噪音。
 */
function mergeAdjacentTextNodes(nodes: ProfileTemplateNodeDto[]): ProfileTemplateNodeDto[] {
    const result: ProfileTemplateNodeDto[] = [];
    for (const node of nodes) {
        const previous = result.at(-1);
        if (previous?.type === "Text" && node.type === "Text" && previous.textKind === node.textKind) {
            previous.text = `${previous.text ?? ""}${node.text ?? ""}`;
            previous.sourceRange = previous.sourceRange && node.sourceRange
                ? {start: previous.sourceRange.start, end: node.sourceRange.end}
                : previous.sourceRange;
            continue;
        }
        result.push(node);
    }
    return result;
}

/**
 * 判断表达式是否是 JSX 根。
 */
function isJsxExpression(expression: TypeScript.Expression): expression is TypeScript.JsxElement | TypeScript.JsxSelfClosingElement {
    return ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression);
}

/**
 * 判断表达式是否是 ProfilePrompt 根节点。
 */
function isProfilePromptExpression(expression: TypeScript.Expression, sourceFile: TypeScript.SourceFile): boolean {
    if (ts.isJsxElement(expression)) {
        return expression.openingElement.tagName.getText(sourceFile) === "ProfilePrompt";
    }
    if (ts.isJsxSelfClosingElement(expression)) {
        return expression.tagName.getText(sourceFile) === "ProfilePrompt";
    }
    return false;
}

/**
 * 判断节点是否是嵌套函数边界。
 */
function isNestedFunctionLike(node: TypeScript.Node): boolean {
    return ts.isFunctionDeclaration(node)
        || ts.isFunctionExpression(node)
        || ts.isArrowFunction(node)
        || ts.isMethodDeclaration(node);
}

/**
 * 判断组件名是否属于 active Profile DSL。
 */
function isComponentType(type: string): type is ProfileTemplateNodeType {
    return PROFILE_DSL_COMPONENTS.has(type as ProfileTemplateNodeType);
}

/**
 * 移除表达式外层括号。
 */
function unwrapParenthesized<T extends TypeScript.Expression>(expression: T): TypeScript.Expression {
    let current: TypeScript.Expression = expression;
    while (ts.isParenthesizedExpression(current)) {
        current = current.expression;
    }
    return current;
}

/**
 * 用源码位置生成稳定节点 id。
 */
function createNodeId(type: ProfileTemplateNodeType, start: number): string {
    return `${type.toLowerCase()}-${Math.max(0, start)}`;
}

/**
 * 规范化 JSX 文本缩进。
 */
function normalizeText(text: string): string {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    while (lines.length > 0 && !lines[0]?.trim()) {
        lines.shift();
    }
    while (lines.length > 0 && !lines.at(-1)?.trim()) {
        lines.pop();
    }
    const indents = lines
        .filter((line) => line.trim())
        .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
    const commonIndent = indents.length > 0 ? Math.min(...indents) : 0;
    return lines.map((line) => line.slice(Math.min(commonIndent, line.length))).join("\n");
}

/**
 * 解码 JSX 文本实体。
 */
function decodeJsxTextEntities(text: string): string {
    return text
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", "\"")
        .replaceAll("&apos;", "'")
        .replaceAll("&amp;", "&");
}
