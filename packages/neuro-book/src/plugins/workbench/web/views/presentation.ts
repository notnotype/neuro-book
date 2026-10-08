/**
 * 呈现模型（外壳设计稿第 8 节，docs/specs/ui/workbench-shell.md 外壳二输出 15–17、24、26）：组件只消费这一份结果，
 * 不各自重算可见性、模式、标题回落与常驻资格。纯函数；组件、DOM、`load()` 的 Promise 与实例表都不在这里。
 */

import type {LocalizedText} from "nbook/shared/localized-text";

import {VIEW_LOCATIONS, viewSizeLimits} from "../../shared/views";
import type {ViewLocation} from "../../shared/views";
import type {LayoutCustomizations, Placement, ViewCatalog} from "./placement";

/** 容器内部的排列轴：侧栏与右栏纵向（视图尺寸是高度），Panel 横向（宽度），与 Panel 停在哪一侧无关。 */
export type ContainerAxis = "vertical" | "horizontal";

export type ContainerMode = "empty" | "single" | "multiple";

export interface SwitcherItem {
    readonly containerId: string;
    readonly title: LocalizedText;
    readonly icon: string;
}

export interface PartPresentation {
    readonly switcher: ReadonlyArray<SwitcherItem>;
    readonly selected: string | null;
    readonly axis: ContainerAxis;
}

export interface ViewSlot {
    readonly id: string;
    readonly title: LocalizedText;
    readonly icon: string;
    readonly layout: "scroll" | "fill";
    readonly movable: boolean;
    /** 生效的收起：只在 multiple 应用；single 时为 false，保存值不变。 */
    readonly collapsed: boolean;
    /** 当前轴上的尺寸意图；没记录过为 null（按默认份额）。 */
    readonly size: number | null;
    readonly minSize: number;
    readonly maxSize: number;
}

export interface ContainerPresentation {
    readonly id: string;
    readonly part: ViewLocation;
    readonly axis: ContainerAxis;
    readonly title: LocalizedText;
    readonly icon: string;
    readonly mode: ContainerMode;
    /** 实际成员（含隐藏的），按顺序。 */
    readonly members: ReadonlyArray<string>;
    /** 可见成员；隐藏不计数，收起计数。 */
    readonly views: ReadonlyArray<ViewSlot>;
    /** Sidebar 只在 single 时画 32px 容器标题行；multiple 每个视图有自己的标题。 */
    readonly showContainerTitle: boolean;
}

export interface Presentation {
    readonly parts: Readonly<Record<ViewLocation, PartPresentation>>;
    /** 常驻容器：有实际成员的容器都常驻，不论是否选中。 */
    readonly containers: ReadonlyMap<string, ContainerPresentation>;
    readonly diagnostics: ReadonlyArray<string>;
}

export interface PresentationInput {
    readonly catalog: ViewCatalog;
    readonly placement: Placement;
    readonly customizations: LayoutCustomizations;
    /** 按条件暂时隐藏的视图（视图的 `when` 随消费者加入，现在总是空）。 */
    readonly hidden?: ReadonlySet<string>;
}

export function axisOf(part: ViewLocation): ContainerAxis {
    return part === "panel" ? "horizontal" : "vertical";
}

/** 当前轴对应的尺寸字段。 */
export function sizeFieldOf(axis: ContainerAxis): "width" | "height" {
    return axis === "horizontal" ? "width" : "height";
}

export function buildPresentation(input: PresentationInput): Presentation {
    const {catalog, placement, customizations} = input;
    const hidden = input.hidden ?? new Set<string>();
    const recordedViews = customizations.views ?? {};
    const diagnostics = [...placement.diagnostics];
    const containers = new Map<string, ContainerPresentation>();

    for (const container of placement.containers.values()) {
        const axis = axisOf(container.part);
        const field = sizeFieldOf(axis);
        const visibleIds = container.members.filter((id) => !hidden.has(id));
        const mode: ContainerMode = visibleIds.length === 0 ? "empty" : visibleIds.length === 1 ? "single" : "multiple";
        const views = visibleIds.map((id): ViewSlot => {
            const declaration = catalog.get(id)!;
            const entry = recordedViews[id];
            const limits = viewSizeLimits(declaration, field);
            return {
                id,
                title: declaration.title,
                icon: declaration.icon,
                layout: declaration.layout,
                movable: declaration.movable !== false,
                collapsed: mode === "multiple" && entry?.collapsed === true,
                size: entry?.[field] ?? null,
                minSize: limits.min,
                maxSize: limits.max,
            };
        });
        // 标题与图标的回落：首个可见成员 → 首个实际成员 → 起源视图的声明 → 容器 id（诊断）。
        const source = catalog.get(visibleIds[0] ?? container.members[0] ?? container.origin ?? "");
        if (source === undefined) diagnostics.push(`容器 ${container.id} 找不到标题来源，按容器 id 显示`);
        containers.set(container.id, {
            id: container.id,
            part: container.part,
            axis,
            title: source?.title ?? {"zh-CN": container.id, "en-US": container.id},
            icon: source?.icon ?? "i-lucide-square",
            mode,
            members: container.members,
            views,
            showContainerTitle: container.part === "sidebar" && mode === "single",
        });
    }

    const parts = Object.fromEntries(VIEW_LOCATIONS.map((part): [ViewLocation, PartPresentation] => [part, {
        switcher: placement.parts[part].map((id) => {
            const container = containers.get(id)!;
            return {containerId: id, title: container.title, icon: container.icon};
        }),
        selected: placement.selected[part],
        axis: axisOf(part),
    }])) as Record<ViewLocation, PartPresentation>;

    return {parts, containers, diagnostics};
}

export interface MoveTargetGroup {
    readonly part: ViewLocation;
    readonly targets: ReadonlyArray<SwitcherItem>;
}

export interface MoveTargets {
    readonly viewId: string;
    readonly sourceContainerId: string;
    /**
     * 除来源外的全部容器，含同一 Part 的，按 Part 分组；三个 Part 都列出（没有已有容器的组只剩“新建容器（在 X）”，
     * 那一项由显示方按组补上）。
     */
    readonly groups: ReadonlyArray<MoveTargetGroup>;
    /** 视图不在默认位置时可以“重置位置”。 */
    readonly canReset: boolean;
}

/** “移动到”菜单与命令面板选择共用的目标表（ui/workbench-shell.md 输出 24）；视图未登记或不可移动为 null。 */
export function moveTargetsOf(presentation: Presentation, placement: Placement, catalog: ViewCatalog, viewId: string): MoveTargets | null {
    const declaration = catalog.get(viewId);
    const current = placement.views.get(viewId);
    if (declaration === undefined || current === undefined || declaration.movable === false) return null;
    const groups = VIEW_LOCATIONS.map((part) => ({
        part,
        targets: presentation.parts[part].switcher.filter((item) => item.containerId !== current.container),
    }));
    return {viewId, sourceContainerId: current.container, groups, canReset: current.source === "record"};
}
