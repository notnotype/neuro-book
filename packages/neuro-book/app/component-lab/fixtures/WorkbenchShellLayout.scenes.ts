import type WorkbenchShellLayout from "nbook/app/components/workbench/WorkbenchShellLayout.vue";
import type {LabFixtureDefinition} from "./index";

const sizes = {leftPanelWidth: 220, agentPanelWidth: 220, panelHeight: 200, panelWidth: 320};
const panel = {position: "bottom", alignment: "center", hidden: false, collapsed: false, maximized: false} as const;
const hiddenParts = ["right"];

/** Every scene exposes the real layout's JSON props; host-only placements and probes stay in the fixture. */
export const WORKBENCH_SHELL_LAYOUT_SCENES = [
    {id: "default", label: "默认（底部 / 居中）", input: {props: {sizes, panel, contextKey: "lab-skeleton:default", hiddenParts, dragCollapsedParts: {}, disabled: false}}},
    {id: "panel-positions", label: "Panel 在左侧", input: {props: {sizes, panel: {...panel, position: "left"}, contextKey: "lab-skeleton:panel-positions", hiddenParts, dragCollapsedParts: {}, disabled: false}}},
    {id: "panel-alignments", label: "底部 / 两端对齐", input: {props: {sizes, panel: {...panel, alignment: "justify"}, contextKey: "lab-skeleton:panel-alignments", hiddenParts, dragCollapsedParts: {}, disabled: false}}},
    {id: "panel-collapsed", label: "32px 标题头", input: {props: {sizes, panel: {...panel, collapsed: true}, contextKey: "lab-skeleton:panel-collapsed", hiddenParts, dragCollapsedParts: {}, disabled: false}}},
    {id: "panel-hidden", label: "隐藏（零占用）", input: {props: {sizes, panel: {...panel, hidden: true}, contextKey: "lab-skeleton:panel-hidden", hiddenParts, dragCollapsedParts: {}, disabled: false}}},
    {id: "panel-maximized", label: "最大化（瞬时）", input: {props: {sizes, panel: {...panel, maximized: true}, contextKey: "lab-skeleton:panel-maximized", hiddenParts, dragCollapsedParts: {}, disabled: false}}},
    {id: "empty-panel", label: "空 Panel", input: {props: {sizes, panel, contextKey: "lab-skeleton:empty-panel", hiddenParts: [], dragCollapsedParts: {}, disabled: false}}},
    {id: "containers", label: "多容器单选（含空容器）", input: {props: {sizes, panel, contextKey: "lab-skeleton:containers", hiddenParts: [], dragCollapsedParts: {}, disabled: false}}},
    {id: "container-moved", label: "整容器搬到 Panel", input: {props: {sizes, panel, contextKey: "lab-skeleton:container-moved", hiddenParts, dragCollapsedParts: {}, disabled: false}}},
    {id: "view-reordered", label: "容器内换序", input: {props: {sizes, panel, contextKey: "lab-skeleton:view-reordered", hiddenParts, dragCollapsedParts: {}, disabled: false}}},
    {id: "view-actions", label: "View 贡献的标题动作", input: {props: {sizes, panel, contextKey: "lab-skeleton:view-actions", hiddenParts, dragCollapsedParts: {}, disabled: false}}},
    {id: "narrow", label: "窄画布 390×844（紧凑）", input: {props: {sizes, panel, contextKey: "lab-skeleton:narrow", hiddenParts, dragCollapsedParts: {}, disabled: false}}},
    {id: "short", label: "短容器（高 260）", input: {props: {sizes, panel, contextKey: "lab-skeleton:short", hiddenParts, dragCollapsedParts: {}, disabled: false}}},
    {id: "lifetime", label: "实例生命周期探针", input: {props: {sizes, panel, contextKey: "lab-skeleton:lifetime", hiddenParts, dragCollapsedParts: {}, disabled: false}}},
    {id: "view-hidden", label: "视图不可见（空态给原因）", input: {props: {sizes, panel, contextKey: "lab-skeleton:view-hidden", hiddenParts: [], dragCollapsedParts: {}, disabled: false}}},
    {id: "unknown-factory", label: "未知 factoryKey（失败可见）", input: {props: {sizes, panel, contextKey: "lab-skeleton:unknown-factory", hiddenParts, dragCollapsedParts: {}, disabled: false}}},
] satisfies LabFixtureDefinition<typeof WorkbenchShellLayout>["scenes"];
