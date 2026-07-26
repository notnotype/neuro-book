import type {JsonValue, WorldPreviewSchemaAttr} from "nbook/app/utils/world-engine-preview";

/**
 * World Engine 状态总览的展示配置层。
 *
 * 配置文件：Project Workspace 下的 `world-engine/state-view.json`（可选）。
 * 由用户或 leader agent 编写，描述「怎么展示」——分组、置顶、widget 选择；
 * 配置非法时整体回退 schema 默认渲染并报告 issues，绝不阻断面板。
 */

/** 有界 widget 库：配置只能从中选择，未知值回退自动推断。 */
export const STATE_VIEW_WIDGETS = ["text", "number", "progress", "badge", "chips", "item-list", "ref", "json"] as const;
export type StateViewWidget = (typeof STATE_VIEW_WIDGETS)[number];

export type StateViewAttrConfig = {
    /** 展示 widget；缺省按 schema 自动推断。 */
    widget?: StateViewWidget;
    /** progress widget 的最大值。 */
    max?: number;
    /** 强调色：accent / danger / warning / success。 */
    color?: "accent" | "danger" | "warning" | "success";
    /** 覆盖属性显示名。 */
    label?: string;
    /** 隐藏该属性（仍可在「全部属性」展开中看到）。 */
    hidden?: boolean;
};

export type StateViewSectionConfig = {
    title: string;
    attrs: string[];
};

export type StateViewTypeConfig = {
    /** lucide 图标名（不带 i-lucide- 前缀）。 */
    icon?: string;
    /** 分类显示名，如「角色」。 */
    label?: string;
    /** 卡片标题使用的属性名；缺省用 subject name。 */
    titleAttr?: string;
    /** 卡片顶部直接露出的关键属性。 */
    pinned?: string[];
    /** 详情分组；未列出的属性归入「其他」。 */
    sections?: StateViewSectionConfig[];
    /** 每个属性的展示配置。 */
    display?: Record<string, StateViewAttrConfig>;
    /** 分类排序权重，小的在前。 */
    order?: number;
};

export type StateViewConfig = {
    version?: number;
    types: Record<string, StateViewTypeConfig>;
};

export type StateViewConfigParseResult = {
    config: StateViewConfig;
    issues: string[];
};

export const EMPTY_STATE_VIEW_CONFIG: StateViewConfig = {types: {}};

const VALID_COLORS = new Set(["accent", "danger", "warning", "success"]);

/**
 * 解析并校验 state-view.json。非法字段逐项丢弃并记录 issue；
 * 整体不是对象时回退空配置。
 */
export function parseStateViewConfig(raw: string): StateViewConfigParseResult {
    const issues: string[] = [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        return {config: EMPTY_STATE_VIEW_CONFIG, issues: [`state-view.json 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`]};
    }
    if (!isRecord(parsed)) {
        return {config: EMPTY_STATE_VIEW_CONFIG, issues: ["state-view.json 根节点必须是对象"]};
    }
    const typesRaw = parsed.types;
    if (typesRaw === undefined) {
        return {config: EMPTY_STATE_VIEW_CONFIG, issues: ["state-view.json 缺少 types 字段"]};
    }
    if (!isRecord(typesRaw)) {
        return {config: EMPTY_STATE_VIEW_CONFIG, issues: ["state-view.json 的 types 必须是对象"]};
    }
    const types: Record<string, StateViewTypeConfig> = {};
    for (const [typeName, typeRaw] of Object.entries(typesRaw)) {
        if (!isRecord(typeRaw)) {
            issues.push(`types.${typeName} 必须是对象，已忽略`);
            continue;
        }
        types[typeName] = normalizeTypeConfig(typeName, typeRaw, issues);
    }
    return {config: {version: typeof parsed.version === "number" ? parsed.version : undefined, types}, issues};
}

function normalizeTypeConfig(typeName: string, raw: Record<string, unknown>, issues: string[]): StateViewTypeConfig {
    const config: StateViewTypeConfig = {};
    if (typeof raw.icon === "string" && raw.icon.trim()) config.icon = raw.icon.trim();
    if (typeof raw.label === "string" && raw.label.trim()) config.label = raw.label.trim();
    if (typeof raw.titleAttr === "string" && raw.titleAttr.trim()) config.titleAttr = raw.titleAttr.trim();
    if (typeof raw.order === "number" && Number.isFinite(raw.order)) config.order = raw.order;
    if (raw.pinned !== undefined) {
        if (Array.isArray(raw.pinned)) {
            config.pinned = raw.pinned.filter((item): item is string => typeof item === "string" && item.trim() !== "");
        } else {
            issues.push(`types.${typeName}.pinned 必须是字符串数组，已忽略`);
        }
    }
    if (raw.sections !== undefined) {
        if (Array.isArray(raw.sections)) {
            const sections: StateViewSectionConfig[] = [];
            for (const [index, sectionRaw] of raw.sections.entries()) {
                if (!isRecord(sectionRaw) || typeof sectionRaw.title !== "string" || !Array.isArray(sectionRaw.attrs)) {
                    issues.push(`types.${typeName}.sections[${index}] 需要 {title, attrs[]}，已忽略`);
                    continue;
                }
                sections.push({
                    title: sectionRaw.title,
                    attrs: sectionRaw.attrs.filter((item): item is string => typeof item === "string" && item.trim() !== ""),
                });
            }
            config.sections = sections;
        } else {
            issues.push(`types.${typeName}.sections 必须是数组，已忽略`);
        }
    }
    if (raw.display !== undefined) {
        if (isRecord(raw.display)) {
            const display: Record<string, StateViewAttrConfig> = {};
            for (const [attrName, attrRaw] of Object.entries(raw.display)) {
                if (!isRecord(attrRaw)) {
                    issues.push(`types.${typeName}.display.${attrName} 必须是对象，已忽略`);
                    continue;
                }
                display[attrName] = normalizeAttrConfig(typeName, attrName, attrRaw, issues);
            }
            config.display = display;
        } else {
            issues.push(`types.${typeName}.display 必须是对象，已忽略`);
        }
    }
    return config;
}

function normalizeAttrConfig(typeName: string, attrName: string, raw: Record<string, unknown>, issues: string[]): StateViewAttrConfig {
    const config: StateViewAttrConfig = {};
    if (raw.widget !== undefined) {
        if (typeof raw.widget === "string" && (STATE_VIEW_WIDGETS as readonly string[]).includes(raw.widget)) {
            config.widget = raw.widget as StateViewWidget;
        } else {
            issues.push(`types.${typeName}.display.${attrName}.widget 不在支持列表（${STATE_VIEW_WIDGETS.join("/")}），已回退自动推断`);
        }
    }
    if (raw.max !== undefined) {
        if (typeof raw.max === "number" && Number.isFinite(raw.max) && raw.max > 0) {
            config.max = raw.max;
        } else {
            issues.push(`types.${typeName}.display.${attrName}.max 必须是正数，已忽略`);
        }
    }
    if (raw.color !== undefined) {
        if (typeof raw.color === "string" && VALID_COLORS.has(raw.color)) {
            config.color = raw.color as StateViewAttrConfig["color"];
        } else {
            issues.push(`types.${typeName}.display.${attrName}.color 只支持 accent/danger/warning/success，已忽略`);
        }
    }
    if (typeof raw.label === "string" && raw.label.trim()) config.label = raw.label.trim();
    if (typeof raw.hidden === "boolean") config.hidden = raw.hidden;
    return config;
}

/** 属性的最终展示视图（配置 + 自动推断合并结果）。 */
export type ResolvedAttrView = {
    attr: WorldPreviewSchemaAttr;
    widget: StateViewWidget;
    label: string;
    max?: number;
    color: string;
    hidden: boolean;
    /** desc "ref:xxx" 中的目标类型；ref widget 用于下拉过滤。 */
    refType?: string;
    editable: boolean;
};

/**
 * 合并配置与 schema 自动推断，得出单个属性的展示视图。
 * 自动推断规则：enum→badge、数值→number（配 max 时→progress）、
 * ref→ref、标量数组→chips、对象数组→item-list、object→json、其余→text。
 */
export function resolveAttrView(attr: WorldPreviewSchemaAttr, config: StateViewAttrConfig | undefined): ResolvedAttrView {
    const refType = attr.desc?.startsWith("ref:") ? attr.desc.slice(4).trim() : undefined;
    const widget = config?.widget ?? inferWidget(attr, config, refType);
    return {
        attr,
        widget,
        label: config?.label ?? attr.name,
        max: config?.max,
        color: config?.color ?? "accent",
        hidden: config?.hidden ?? false,
        refType,
        editable: widget !== "item-list" || attr.kind !== "object",
    };
}

function inferWidget(attr: WorldPreviewSchemaAttr, config: StateViewAttrConfig | undefined, refType: string | undefined): StateViewWidget {
    if (refType) {
        return "ref";
    }
    if (attr.enum && attr.enum.length > 0) {
        return "badge";
    }
    if (attr.kind === "scalar") {
        if (attr.type === "number") {
            return config?.max !== undefined ? "progress" : "number";
        }
        if (attr.type === "boolean") {
            return "badge";
        }
        return "text";
    }
    if (attr.kind === "list" || attr.kind === "collection") {
        if (attr.itemType === "object") {
            return "item-list";
        }
        return "chips";
    }
    return "json";
}

/** 卡片布局：分组后的属性视图。 */
export type ResolvedCardLayout = {
    pinned: ResolvedAttrView[];
    sections: Array<{title: string; views: ResolvedAttrView[]}>;
};

/**
 * 按类型配置计算卡片布局：pinned 优先；sections 按配置分组；
 * 配置未覆盖的属性自动归入「其他」组，保证 schema 新增属性永远可见。
 */
export function resolveCardLayout(schemaAttrs: WorldPreviewSchemaAttr[], typeConfig: StateViewTypeConfig | undefined): ResolvedCardLayout {
    const display = typeConfig?.display ?? {};
    const attrByName = new Map(schemaAttrs.map((attr) => [attr.name, attr]));
    const used = new Set<string>();

    const viewFor = (name: string): ResolvedAttrView | null => {
        const attr = attrByName.get(name);
        if (!attr) {
            return null;
        }
        used.add(name);
        return resolveAttrView(attr, display[name]);
    };

    const pinned = (typeConfig?.pinned ?? [])
        .map(viewFor)
        .filter((view): view is ResolvedAttrView => view !== null && !view.hidden);

    const sections: ResolvedCardLayout["sections"] = [];
    for (const section of typeConfig?.sections ?? []) {
        const views = section.attrs
            .map(viewFor)
            .filter((view): view is ResolvedAttrView => view !== null && !view.hidden);
        if (views.length) {
            sections.push({title: section.title, views});
        }
    }

    const rest = schemaAttrs
        .filter((attr) => !used.has(attr.name))
        .map((attr) => resolveAttrView(attr, display[attr.name]))
        .filter((view) => !view.hidden);
    if (rest.length) {
        sections.push({title: sections.length || pinned.length ? "其他" : "属性", views: rest});
    }

    return {pinned, sections};
}

/** 分类（subject type）级排序与显示名。 */
export function resolveTypeLabel(typeName: string, typeConfig: StateViewTypeConfig | undefined, schemaDesc: string | undefined): string {
    return typeConfig?.label ?? schemaDesc ?? typeName;
}

const DEFAULT_TYPE_ICONS: Record<string, string> = {
    world: "globe-2",
    character: "user",
    location: "map-pin",
    faction: "flag",
    item: "package",
    organization: "building-2",
};

export function resolveTypeIcon(typeName: string, typeConfig: StateViewTypeConfig | undefined): string {
    return typeConfig?.icon ?? DEFAULT_TYPE_ICONS[typeName] ?? "box";
}

/** 暂存的一条编辑：JSON Pointer path + 新值。 */
export type StagedStateEdit = {
    subjectId: string;
    subjectName: string;
    /** JSON Pointer，如 /hp。 */
    path: string;
    attrLabel: string;
    value: JsonValue;
    /** 编辑前的展示值，用于暂存条摘要。 */
    originalText: string;
};

export function stagedEditKey(edit: Pick<StagedStateEdit, "subjectId" | "path">): string {
    return `${edit.subjectId}\u0000${edit.path}`;
}

/** 展示用短文本。 */
export function formatStateValue(value: JsonValue | undefined): string {
    if (value === undefined) return "—";
    if (value === null) return "null";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.length === 0 ? "[]" : `${value.length} 项`;
    return `${Object.keys(value).length} 字段`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
