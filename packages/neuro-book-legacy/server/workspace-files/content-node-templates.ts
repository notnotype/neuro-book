import fs from "node:fs";
import path from "node:path";
import {assetResolver} from "nbook/server/assets/asset-resolver";
import type {WorkspaceContentStatus, WorkspaceContentType} from "nbook/server/workspace-files/content-node-schema";

export type WorkspaceContentTemplateInput = {
    title: string;
    type: WorkspaceContentType;
    status: WorkspaceContentStatus;
};

export type WorkspaceContentTemplateBundle = {
    indexContent: string;
    stateContent: string | null;
};

const TEMPLATE_ROOT_RELATIVE_PATH = path.join("templates", "content-node-templates");

/**
 * 按内容节点类型读取 index.md 模板，并替换基础变量。
 */
export function renderWorkspaceContentTemplate(input: WorkspaceContentTemplateInput): string {
    const templatePath = path.join(TEMPLATE_ROOT_RELATIVE_PATH, input.type, "index.md");
    return renderTemplateFile(templatePath, input);
}

/**
 * 按内容节点类型读取可选 state.md 模板，并替换基础变量。
 */
export function renderWorkspaceStateTemplate(input: WorkspaceContentTemplateInput): string {
    const templatePath = path.join(TEMPLATE_ROOT_RELATIVE_PATH, input.type, "state.md");
    const resolvedTemplatePath = resolveTemplatePath(templatePath);
    if (!resolvedTemplatePath) {
        throw new Error(`内容节点类型 ${input.type} 暂无 state.md 模板`);
    }
    return renderTemplateFilePath(resolvedTemplatePath, input);
}

/**
 * 读取内容节点 index.md 与可选 state.md 模板。
 */
export function renderWorkspaceContentTemplateBundle(input: WorkspaceContentTemplateInput, includeState: boolean): WorkspaceContentTemplateBundle {
    return {
        indexContent: renderWorkspaceContentTemplate(input),
        stateContent: includeState ? renderWorkspaceStateTemplate(input) : null,
    };
}

/**
 * 读取模板文件并替换基础变量。
 */
function renderTemplateFile(templatePath: string, input: WorkspaceContentTemplateInput): string {
    const resolvedTemplatePath = resolveTemplatePath(templatePath);
    if (!resolvedTemplatePath) {
        throw new Error(`assets 模板不存在: ${templatePath.split(path.sep).join("/")}`);
    }
    return renderTemplateFilePath(resolvedTemplatePath, input);
}

/**
 * 读取已解析模板文件并替换基础变量。
 */
function renderTemplateFilePath(templatePath: string, input: WorkspaceContentTemplateInput): string {
    const template = fs.readFileSync(templatePath, "utf-8");
    return template
        .replaceAll("\"{{title}}\"", formatYamlString(input.title))
        .replaceAll("{{title}}", formatYamlString(input.title))
        .replaceAll("\"{{status}}\"", formatYamlString(input.status))
        .replaceAll("{{status}}", formatYamlString(input.status));
}

/**
 * 同步解析模板路径。该 CLI 路径仍是同步渲染，所以这里只做最小文件探测。
 */
function resolveTemplatePath(relativePath: string): string | null {
    const normalizedPath = relativePath.split(path.sep).join(path.sep);
    return assetResolver.resolveFileSync(normalizedPath)?.absolutePath ?? null;
}

/**
 * 将字符串格式化为安全的 YAML 标量。
 */
function formatYamlString(value: string): string {
    const trimmedValue = value.trim();
    if (/^[^\s:[\]{},#&*!|>'"%@`][^:[\]{},#&*!|>'"%@`]*$/.test(trimmedValue)) {
        return trimmedValue;
    }
    return JSON.stringify(value);
}
