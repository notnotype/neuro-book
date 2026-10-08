/**
 * 工作台的布局 store（docs/specs/ui/workbench-shell.md 外壳一，docs/specs/state/store.md）：三条布局记录的持久化字段、
 * 只在内存的瞬时最大化与呈现事实，以及外壳组件、状态栏与面板命令用的 action。
 *
 * - 定制按字段写：每个 action 的 change 只改它负责的那个字段，冲突重放时同一个 change 作用在最新值上，另一个窗口改的
 *   别的字段因此保留（输出“状态与转换”）。不把整份显示值当作待保存的值。
 * - 同值不写：与当前显示相同的修改不产生保存。
 * - 呈现事实只经 `acceptLayoutFacts` 进来：外壳组件按实测容器算出模式与生效的面板状态；内存里的最大化在事实里已经不
 *   成立（进入紧凑）时清掉，回到宽屏不复活。
 * - action 不等保存：显示立即更新，保存结果看各字段的保存状态（状态栏据此显示“布局未保存”）。
 * - 视图与容器（外壳二）：视图目录由工作台入口经 `acceptViewCatalog` 交进来，落位与呈现模型从目录和定制的当前显示
 *   求出；每个意图先按发起时的呈现合成一份按字段的补丁（`web/views/intents.ts`），冲突重放时同一份补丁作用在最新值上。
 */

import {computed, shallowRef} from "@vue/reactivity";
import type {DeepReadonly} from "@vue/reactivity";

import {defineStore} from "nbook/shared/store/store";

import {clampLeafSize, clampPanelHeight, clampPanelWidth, SHELL_SIZE_DEFAULTS, shellLeafLimits} from "../shell/sizes";
import type {ShellDragCollapseMap, ShellHideablePart, ShellLayoutFacts, ShellSizePatch, ShellSizePreferences} from "../shell/sizes";
import {isHorizontalPanelPosition, PANEL_ALIGNMENTS, PANEL_DEFAULTS, PANEL_POSITIONS, panelMaximizable} from "../shell/panel-state";
import type {PanelAlignment, PanelPosition, PanelPreferences, PanelState} from "../shell/panel-state";
import {applyIntent, applyPatch} from "../views/intents";
import type {IntentResult, ViewIntent} from "../views/intents";
import {computePlacement} from "../views/placement";
import type {ViewCatalog} from "../views/placement";
import {buildPresentation} from "../views/presentation";
import type {ShellPartId} from "../shell/sizes";
import {LAYOUT_RECORDS} from "./records";
import type {Customizations, LayoutRecords} from "./records";

export type LayoutRecordName = "side" | "panelSize" | "customizations";

/** 一条记录的问题：读不到或受保护（按默认显示），或有修改没保存上（显示的是未保存的值）。 */
export interface LayoutProblem {
    readonly record: LayoutRecordName;
    readonly kind: "unread" | "unsaved";
    readonly code: string;
}

type PanelPatch = Partial<PanelPreferences>;

/** change 拿到的是冻结的只读值：复制一份可写的再改（记录值都是 JSON）。 */
function editable(value: DeepReadonly<Customizations>): Customizations {
    return structuredClone(value) as Customizations;
}

function defineLayoutStore(records: LayoutRecords) {
    return defineStore("workbench-layout", ({persist}) => {
        const side = persist(records.side, {initial: {}});
        const panelSize = persist(records.panelSize, {initial: {}});
        const customizations = persist(records.customizations, {initial: {}});
        const fields = {side, panelSize, customizations} as const;
        const maximized = shallowRef(false);
        const facts = shallowRef<ShellLayoutFacts | null>(null);
        const catalog = shallowRef<ViewCatalog>(new Map());
        /** 最近获得焦点的 Part（输出 27）：焦点移到外壳之外时不变，所以只有外壳里的 focusin 会改它。 */
        const focusedPart = shallowRef<ShellPartId>("editor");
        const placement = computed(() => computePlacement(catalog.value, customizations.display));
        const presentation = computed(() => buildPresentation({catalog: catalog.value, placement: placement.value, customizations: customizations.display}));

        const sizes = computed<ShellSizePreferences>(() => ({
            sidebarWidth: side.display.sidebarWidth ?? SHELL_SIZE_DEFAULTS.sidebarWidth,
            auxiliarybarWidth: side.display.auxiliarybarWidth ?? SHELL_SIZE_DEFAULTS.auxiliarybarWidth,
            panelHeight: panelSize.display.panelHeight ?? SHELL_SIZE_DEFAULTS.panelHeight,
            panelWidth: panelSize.display.panelWidth ?? SHELL_SIZE_DEFAULTS.panelWidth,
        }));
        const panel = computed<PanelState>(() => {
            const saved = customizations.display.panel ?? {};
            return {
                position: saved.position ?? PANEL_DEFAULTS.position,
                alignment: saved.alignment ?? PANEL_DEFAULTS.alignment,
                hidden: saved.hidden ?? PANEL_DEFAULTS.hidden,
                collapsed: saved.collapsed ?? PANEL_DEFAULTS.collapsed,
                maximized: maximized.value,
            };
        });
        const hiddenParts = computed<ReadonlyArray<ShellHideablePart>>(() => customizations.display.hiddenParts ?? []);
        const dragCollapsed = computed<ShellDragCollapseMap>(() => customizations.display.dragCollapsed ?? {});
        const ready = computed(() => side.ready && panelSize.ready && customizations.ready);
        const problems = computed<ReadonlyArray<LayoutProblem>>(() => (Object.keys(fields) as LayoutRecordName[]).flatMap((record): LayoutProblem[] => {
            const field = fields[record];
            const save = field.save;
            if (save.state === "failed" || save.state === "unknown") return [{record, kind: "unsaved", code: save.code}];
            if (field.failure !== null) return [{record, kind: "unread", code: field.failure}];
            // 损坏或版本不支持的记录受保护：按默认显示，修改不保存（`state/store.md` 输出 12）。
            const status = field.base?.status;
            return status === "corrupt" || status === "unsupported-version" ? [{record, kind: "unread", code: status}] : [];
        }));

        /** 写面板字段组里的几个字段；位置、对齐、隐藏、收起任一变化都清掉瞬时最大化。 */
        const setPanel = (patch: PanelPatch): boolean => {
            const current = panel.value;
            if ((Object.keys(patch) as (keyof PanelPatch)[]).every((name) => current[name] === patch[name])) return false;
            maximized.value = false;
            void customizations.commit((value) => {
                const next = editable(value);
                next.panel = {...next.panel, ...patch};
                return next;
            });
            return true;
        };

        /** 只写补丁里真正变了的尺寸字段；值按各自的区间夹取（补丁来自手势，越界只是防御）。 */
        const commitSizeFields = <K extends keyof ShellSizePreferences>(field: typeof side | typeof panelSize, names: ReadonlyArray<K>, patch: ShellSizePatch, clamp: (name: K, value: number) => number): void => {
            const changed: Partial<Record<K, number>> = {};
            for (const name of names) {
                const value = patch[name];
                if (value === undefined || !Number.isFinite(value)) continue;
                const next = clamp(name, value);
                if (next !== sizes.value[name]) changed[name] = next;
            }
            if (Object.keys(changed).length === 0) return;
            void field.commit((value) => ({...value, ...changed}));
        };

        return {
            state: {side, panelSize, customizations, maximized, facts, sizes, panel, hiddenParts, dragCollapsed, ready, problems, catalog, placement, presentation, focusedPart},
            actions: {
                setPanelPosition: (position: PanelPosition): boolean => (PANEL_POSITIONS as ReadonlyArray<string>).includes(position) && setPanel({position}),
                setPanelAlignment: (alignment: PanelAlignment): boolean => (PANEL_ALIGNMENTS as ReadonlyArray<string>).includes(alignment) && setPanel({alignment}),
                /** 显示面板时同时清除收起与拖到零：“显示面板”要让面板按记忆尺寸完整回来（输出 7、8）。 */
                setPanelHidden: (hidden: boolean): boolean => {
                    if (hidden) return setPanel({hidden});
                    const current = panel.value;
                    if (!current.hidden && !current.collapsed && dragCollapsed.value.panel !== true) return false;
                    maximized.value = false;
                    void customizations.commit((value) => {
                        const next = editable(value);
                        next.panel = {...next.panel, hidden: false, collapsed: false};
                        if (next.dragCollapsed?.panel === true) next.dragCollapsed = {...next.dragCollapsed, panel: false};
                        return next;
                    });
                    return true;
                },
                /** 32px 标题头只对水平位置成立。 */
                setPanelCollapsed: (collapsed: boolean): boolean => isHorizontalPanelPosition(panel.value.position) && setPanel({collapsed}),
                /** 最大化只在左右位置或水平居中、面板显示、不在紧凑呈现时成立；收起着的面板最大化时先展开。 */
                togglePanelMaximized: (): boolean => {
                    if (maximized.value) {
                        maximized.value = false;
                        return true;
                    }
                    const current = panel.value;
                    if (current.hidden || !panelMaximizable(current.position, current.alignment) || facts.value?.mode === "compact") return false;
                    if (current.collapsed && isHorizontalPanelPosition(current.position)) setPanel({collapsed: false});
                    maximized.value = true;
                    return true;
                },
                setPartHidden: (part: ShellHideablePart, hidden: boolean): boolean => {
                    if (hiddenParts.value.includes(part) === hidden) return false;
                    void customizations.commit((value) => {
                        const next = editable(value);
                        const others = (next.hiddenParts ?? []).filter((name) => name !== part);
                        next.hiddenParts = hidden ? [...others, part] : others;
                        return next;
                    });
                    return true;
                },
                /** 一次手势的补丁：涉及的记录各提交一次（两条记录不是事务）。 */
                commitSizes: (patch: ShellSizePatch): void => {
                    commitSizeFields(side, ["sidebarWidth", "auxiliarybarWidth"], patch, (name, value) => clampLeafSize(value, shellLeafLimits(name === "sidebarWidth" ? "sidebar" : "auxiliarybar", Number.MAX_SAFE_INTEGER)));
                    commitSizeFields(panelSize, ["panelHeight", "panelWidth"], patch, (name, value) => (name === "panelHeight" ? clampPanelHeight(value) : clampPanelWidth(value)));
                    const collapse = patch.dragCollapsed;
                    if (collapse !== undefined && Object.entries(collapse).some(([part, value]) => (dragCollapsed.value[part as keyof ShellDragCollapseMap] ?? false) !== value)) {
                        void customizations.commit((value) => {
                            const next = editable(value);
                            next.dragCollapsed = {...next.dragCollapsed, ...collapse};
                            return next;
                        });
                    }
                },
                /** 视图目录变化（登记、交付、撤回不改目录；只有声明集合变了才换）。 */
                acceptViewCatalog: (next: ViewCatalog): void => {
                    catalog.value = next;
                },
                /** 一次视图或容器的意图；拒绝与无变化都不写。返回合成结果，命令据此给出失败码。 */
                applyView: (intent: ViewIntent): IntentResult => {
                    const result = applyIntent({catalog: catalog.value, placement: placement.value, presentation: presentation.value, customizations: customizations.display}, intent);
                    if (result.kind === "patch") void customizations.commit((value) => applyPatch(value, result.patch));
                    return result;
                },
                focusPart: (part: ShellPartId): void => {
                    focusedPart.value = part;
                },
                acceptLayoutFacts: (next: ShellLayoutFacts): void => {
                    facts.value = next;
                    if (maximized.value && !next.effectivePanel.maximized) maximized.value = false;
                },
                /** 重试这条记录暂停的保存；读不到或订阅已结束时先重新打开（`state/store.md` 输出 16）。 */
                retry: async (record: LayoutRecordName): Promise<string> => {
                    const field = fields[record];
                    if (field.failure !== null) await field.reopen();
                    return field.retry();
                },
                /** 放弃这条记录暂停与排队的全部修改，显示回到已确认值。 */
                discard: (record: LayoutRecordName): string => fields[record].discardAll(),
            },
        };
    });
}

const STORES = {user: defineLayoutStore(LAYOUT_RECORDS.user), project: defineLayoutStore(LAYOUT_RECORDS.project)};

export type LayoutStoreDefinition = (typeof STORES)["user"];
export type LayoutStore = ReturnType<LayoutStoreDefinition["create"]>;

/** 窗口绑定了项目时尺寸记录在 project 分区，否则在 user 分区。 */
export function layoutStoreFor(bound: boolean): LayoutStoreDefinition {
    return bound ? STORES.project : STORES.user;
}

