import {
    isExpressionValue,
} from "nbook/app/components/profile-template-editor/profile-template-tree-utils";
import type {ProfileTemplateNodeDto} from "nbook/shared/dto/profile-template.dto";

/**
 * 生成完整 TSX 模板文件。
 * 注意：这里生成的是新 v3 Profile DSL 调试源码，不再使用旧 simple-profile 运行时。
 */
export function generateFullTemplateSource(templateName: string, node: ProfileTemplateNodeDto): string {
    const componentNames = collectComponentNames(node);
    const functionName = toPascalCase(templateName || "ProfileTemplate");
    return [
        "/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */",
        "/** @jsxRuntime automatic */",
        "",
        `import {${[...componentNames].sort().join(", ")}} from "nbook/server/agent/profiles/profile-dsl";`,
        "import type {ProfilePrepareContext} from \"nbook/server/agent/profiles/types\";",
        "",
        `export default async function ${functionName}(ctx: ProfilePrepareContext) {`,
        "    const initial = ctx.initial;",
        "    const runtime = ctx.runtime;",
        "    const session = ctx.session;",
        "",
        "    return (",
        indentPreviewSource(generatePreviewNodeSource(node), 2),
        "    );",
        "}",
    ].join("\n");
}

/**
 * 收集模板使用到的组件名。
 */
export function collectComponentNames(node: ProfileTemplateNodeDto): Set<string> {
    const names = new Set<string>(["ProfilePrompt"]);
    walkNode(node, (current) => {
        if (current.type === "Text") {
            return;
        }
        names.add(current.type);
    });
    return names;
}

/**
 * 遍历节点树。
 */
export function walkNode(node: ProfileTemplateNodeDto, visit: (node: ProfileTemplateNodeDto) => void): void {
    visit(node);
    for (const child of node.children) {
        walkNode(child, visit);
    }
}

/**
 * 转 PascalCase 函数名。
 */
export function toPascalCase(value: string): string {
    const normalized = value
        .replace(/\.tsx$/, "")
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join("");
    return normalized || "ProfileTemplate";
}

/**
 * 生成右侧预览用 TSX 标签片段。
 */
export function generatePreviewNodeSource(node: ProfileTemplateNodeDto): string {
    if (node.type === "Text") {
        return renderPreviewNodeText(node);
    }
    if (node.type === "ToolCall") {
        return generateToolCallSource(node);
    }
    const props = generatePreviewProps(publicRuntimeProps(node));
    if (node.children.length === 0 && !node.text) {
        return `<${node.type}${props} />`;
    }
    if ((node.type === "System" || node.type === "Message" || node.type === "AIMessage" || node.type === "ToolResult") && node.text) {
        const textSource = renderPreviewNodeText(node);
        const childLines = [
            indentPreviewSource(textSource, 1),
            ...node.children.map((child) => indentPreviewSource(generatePreviewNodeSource(child), 1)),
        ];
        return [
            `<${node.type}${props}>`,
            ...childLines,
            `</${node.type}>`,
        ].join("\n");
    }
    const childLines = [
        node.text ? renderPreviewNodeText(node) : "",
        ...node.children.map((child) => generatePreviewNodeSource(child)),
    ].filter(Boolean);
    return [
        `<${node.type}${props}>`,
        ...childLines.map((line) => indentPreviewSource(line, 1)),
        `</${node.type}>`,
    ].join("\n");
}

/**
 * ToolCall 在 runtime DSL 中没有 children，画布正文编辑的是 args 参数。
 */
function generateToolCallSource(node: ProfileTemplateNodeDto): string {
    const props = generatePreviewProps(publicRuntimeProps(node));
    const argsText = node.text?.trim();
    if (!argsText) {
        return `<ToolCall${props} />`;
    }
    return `<ToolCall${props} args={${argsText}} />`;
}

/**
 * 生成 TSX 标签属性。
 */
export function generatePreviewProps(props: ProfileTemplateNodeDto["props"]): string {
    const chunks: string[] = [];
    for (const [key, value] of Object.entries(props)) {
        if (value === null || value === "") {
            continue;
        }
        if (isExpressionValue(value)) {
            chunks.push(`${key}={${value.code}}`);
            continue;
        }
        if (typeof value === "string") {
            chunks.push(`${key}=${JSON.stringify(value)}`);
        } else {
            chunks.push(`${key}={${String(value)}}`);
        }
    }
    return chunks.length > 0 ? ` ${chunks.join(" ")}` : "";
}

/**
 * 过滤低代码编辑器内部展示字段，只把 runtime DSL 接受的属性写回 TSX。
 */
export function publicRuntimeProps(node: ProfileTemplateNodeDto): ProfileTemplateNodeDto["props"] {
    const internalProps = new Set(["status", "source", "previewText"]);
    return Object.fromEntries(Object.entries(node.props).filter(([key]) => !internalProps.has(key)));
}

/**
 * 缩进 TSX 片段。
 */
export function indentPreviewSource(source: string, level: number): string {
    const prefix = "    ".repeat(level);
    return source.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

/**
 * 渲染预览中的节点文本，source 模式保留原始 TSX children 片段。
 */
export function renderPreviewNodeText(node: ProfileTemplateNodeDto): string {
    if (node.textKind === "source") {
        return `{${node.text ?? ""}}`;
    }
    return node.text ? renderMessageTextExpressions(node.text) : "";
}

/**
 * 按行生成 Message 正文表达式，兼顾源码可读性与换行保真。
 */
export function renderMessageTextExpressions(text: string): string {
    const lines = text.replaceAll("\r\n", "\n").split("\n");
    const chunks: string[] = [];
    lines.forEach((line, index) => {
        if (line) {
            chunks.push("{`" + escapeTemplateLine(line) + "`}");
        }
        if (index < lines.length - 1) {
            chunks.push("{\"\\n\"}");
        }
    });
    return chunks.join("\n");
}

/**
 * 转义单行模板字符串正文，保留 ${...} 作为 TSX 运行时插值。
 */
export function escapeTemplateLine(text: string): string {
    return text
        .replaceAll("\\", "\\\\")
        .replaceAll("`", "\\`");
}
