import type {
    PreviewVariableGroup,
    PreviewVariableItem,
} from "nbook/app/components/profile-template-editor/profile-template-editor-ui";

export type RawPreviewVariableItem = {
    label: string;
    value: string;
    path?: string;
    currentValue?: unknown;
    editable?: boolean;
    description?: string;
    valueType?: string;
    source?: string;
    schema?: Record<string, unknown> | null;
    children?: RawPreviewVariableItem[];
};

/**
 * 将服务端变量 DTO 映射为页面展示用的浅类型，避免 Vue 模板递归展开 z.json 类型。
 */
export function mapPreviewVariableGroups(groups: Array<{group: string; items: RawPreviewVariableItem[]}>): PreviewVariableGroup[] {
    return groups.map((group) => ({
        group: group.group,
        items: group.items.map(mapPreviewVariableItem),
    }));
}

/**
 * 将服务端变量 DTO 映射为页面展示用类型。
 */
export function mapPreviewVariableItem(item: RawPreviewVariableItem): PreviewVariableItem {
    const path = item.path ?? item.value.replace(/^\$\{/, "").replace(/}$/, "");
    return {
        label: item.label,
        value: item.value,
        path,
        currentValue: item.currentValue,
        editable: item.editable ?? false,
        description: item.description,
        valueType: item.valueType ?? readPreviewValueType(item.currentValue),
        source: item.source ?? "template",
        schema: item.schema ?? null,
        children: item.children?.map(mapPreviewVariableItem),
    };
}

/**
 * 搜索变量分组，保留命中的父节点与子节点。
 */
export function filterVariableGroups(groups: PreviewVariableGroup[], keyword: string): PreviewVariableGroup[] {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
        return groups;
    }
    return groups
        .map((group) => ({
            group: group.group,
            items: group.items
                .map((item) => filterVariableItem(item, normalizedKeyword))
                .filter((item): item is PreviewVariableItem => Boolean(item)),
        }))
        .filter((group) => group.items.length > 0);
}

/**
 * 搜索变量树中的单个节点。
 */
export function filterVariableItem(item: PreviewVariableItem, keyword: string): PreviewVariableItem | null {
    const children = item.children
        ?.map((child) => filterVariableItem(child, keyword))
        .filter((child): child is PreviewVariableItem => Boolean(child));
    const haystack = [
        item.label,
        item.path,
        item.description ?? "",
        item.source,
        formatVariableValue(item.currentValue),
    ].join(" ").toLowerCase();
    if (haystack.includes(keyword) || children?.length) {
        return {
            ...item,
            children,
        };
    }
    return null;
}

/**
 * 变量当前值展示。
 */
export function formatVariableValue(value: PreviewVariableItem["currentValue"]): string {
    if (value === undefined || value === null) {
        return "未设置";
    }
    if (typeof value === "string") {
        return value || "空字符串";
    }
    return JSON.stringify(value, null, 2);
}

/**
 * 变量 schema 摘要。
 */
export function formatVariableSchema(item: PreviewVariableItem): string {
    const schemaType = item.schema?.type;
    if (typeof schemaType === "string") {
        return schemaType;
    }
    return item.valueType;
}

/**
 * 是否显示变量详情卡片，避免根对象在侧栏里过于吵。
 */
export function shouldShowVariableValue(item: PreviewVariableItem): boolean {
    return item.valueType !== "object" || !item.children?.length;
}

/**
 * 推断变量值类型。
 */
export function readPreviewValueType(value: unknown): string {
    if (value === null || value === undefined) {
        return "null";
    }
    if (Array.isArray(value)) {
        return "array";
    }
    return typeof value;
}
