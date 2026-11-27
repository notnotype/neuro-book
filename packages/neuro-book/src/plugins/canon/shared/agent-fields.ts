/**
 * 给模型看的条目字段（docs/specs/canon/agent-tools.md 的 `canon_read`；作者界面的“AI视图”，author-ui 输出 54）：每个模块一节、
 * 每个字段一行。后端的 Agent 工具与条目页用同一个函数，两边写出来的是同一段字。纯函数，不碰世界；字数上限在这里截。
 */

import {displayText} from "@notnotype/nb-canon/schema";
import type {ComponentType, EntryView, FieldDeclaration} from "@notnotype/nb-canon/schema";

const VALUE_LIMIT = 300;

export function valueText(value: unknown): string {
    if (value === null || value === undefined) return "未知";
    const text = displayText(value);
    return text.length > VALUE_LIMIT ? `${text.slice(0, VALUE_LIMIT)}……（截断）` : text;
}

/** 一个字段的种类与可取的值：选项、范围、单位、可以指向的种类、语义档。 */
function kindText(field: FieldDeclaration): string {
    const parts: string[] = [];
    switch (field.kind) {
        case "number":
            parts.push(field.precision === "semantic" ? "数（语义档：改起点或记一句）" : "数");
            if (field.min !== undefined) parts.push(`最小 ${String(field.min)}`);
            if (field.max !== undefined) parts.push(`最大 ${String(field.max)}`);
            if (field.unit !== undefined) parts.push(`单位 ${field.unit}`);
            break;
        case "text":
            parts.push(field.precision === "semantic" ? "文字（语义档：改起点或记一句）" : "文字");
            // 建议值只是提示（components.md 输出 24）：写明可以写别的，免得模型当成选项。
            if (field.suggestions !== undefined && field.suggestions.length > 0) parts.push(`常见的写法：${field.suggestions.join("、")}（也可以写别的）`);
            break;
        case "enum":
            parts.push(`选项：${(field.options ?? []).join("、")}`);
            break;
        case "boolean":
            parts.push("是否");
            break;
        case "ref":
            parts.push(`引用${field.targets === undefined ? "" : `（可指向：${field.targets.join("、")}）`}`);
            break;
        case "list":
            parts.push(field.keyedBy === "ref" ? `以条目为键的列表${field.targets === undefined ? "" : `（键可指向：${field.targets.join("、")}）`}` : "列表（元素要有名字 label）");
            if (field.item !== undefined && field.item.length > 0) parts.push(`元素的字段：${field.item.map((item) => `${item.label === item.id ? item.id : `${item.label}（${item.id}）`}`).join("、")}`);
            break;
        case "image":
            parts.push("图片 {图片: 作品内路径, 说明}");
            break;
        default:
            parts.push(field.kind);
    }
    return parts.join("；");
}

export const LIST_ROWS = 20;

/**
 * 一个条目的字段：每个模块一节，每个字段一行；列表每个元素一行，最多 `LIST_ROWS` 行。`field` 只写这一个字段（列表写全）；
 * `namespace` 只写这个模块，并且不写“以后才启用”“去掉过”的两行（它们说的是整个条目）。
 */
export function fieldsText(view: EntryView, declarations: Readonly<Record<string, readonly FieldDeclaration[]>>, components: readonly ComponentType[], only: {readonly field?: string; readonly namespace?: string} = {}): string {
    const {field} = only;
    const lines: string[] = [];
    for (const [namespace, data] of Object.entries(view.namespaces)) {
        if (only.namespace !== undefined && namespace !== only.namespace) continue;
        const type = components.find((candidate) => candidate.namespace === namespace);
        const fields = declarations[namespace] ?? [];
        lines.push(`【${type?.label ?? namespace}】（模块 ${namespace}${data.readOnly === undefined ? "" : "，只读"}${type?.instanceFields === true ? "，可以加字段" : ""}）`);
        for (const declaration of fields) {
            const path = `${namespace}.${declaration.id}`;
            if (field !== undefined && field !== path) continue;
            const state = data.fields[declaration.id];
            const name = declaration.label === declaration.id ? declaration.id : `${declaration.label}（${declaration.id}）`;
            if (declaration.kind === "list") {
                const items = Array.isArray(state?.value) ? (state.value as Array<Record<string, unknown>>) : [];
                lines.push(`- ${name}｜${kindText(declaration)}｜${String(items.length)} 项`);
                const limit = field === undefined ? LIST_ROWS : Number.POSITIVE_INFINITY;
                for (const item of items.slice(0, limit)) {
                    const subs = (declaration.item ?? []).map((sub) => `${sub.label}=${valueText(item[sub.id])}`).join("，");
                    lines.push(`  - [${String(item.id)}] ${typeof item.label === "string" ? item.label : ""}${subs === "" ? "" : `｜${subs}`}`);
                }
                if (items.length > limit) lines.push(`  - 还有 ${String(items.length - limit)} 项（用 field: "${path}" 读全）`);
                continue;
            }
            const incomplete = state?.incomplete === undefined ? "" : "（不完整）";
            lines.push(`- ${name} = ${valueText(state?.value)}${incomplete}｜${kindText(declaration)}`);
        }
    }
    if (only.namespace !== undefined) return lines.join("\n");
    if (view.upcoming.length > 0) lines.push(`以后才启用的模块：${view.upcoming.map((item) => item.namespace).join("、")}`);
    if (view.removedComponents !== undefined && view.removedComponents.length > 0) lines.push(`去掉过的模块（可以再加回来）：${view.removedComponents.map((item) => components.find((candidate) => candidate.id === item.type)?.label ?? item.type).join("、")}`);
    return lines.join("\n");
}
