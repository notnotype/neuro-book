/**
 * 视图命令（docs/specs/ui/workbench-layout.md 输出 23、35，docs/specs/workbench/views.md 输出 14）。打开视图：显示它所在的面板、激活；不给 `viewId` 时经选择挑一个。
 * 移动视图：标签的“移动到”带 `{viewId, target}` 直接执行，`target` 是面板 id 或 `{newPanelNextTo: 面板 id}`；命令面板执行 `{}`，经选择先选视图、再选目标。
 *
 * 选择之间视图被别处移走时，按 `stale-target` 拒绝且不写。
 */

import {findTab, tabKey} from "@notnotype/nb-layout";
import type {LayoutResult} from "@notnotype/nb-layout";
import {Type} from "typebox";

import type {CommandImplementation, CommandResult, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import type {TextResolver} from "nbook/shared/localized-text";

import type {QuickPick} from "../../shared/contracts";
import {workbenchText} from "../../shared/text";
import {OPEN_VIEW_COMMAND} from "../../shared/views";
import type {LayoutDocStore} from "../state/layout-doc-store";
import {canResetView, moveTargetsOf, panelTitle} from "../state/layout-present";
import type {MoveTarget} from "../state/layout-present";
import {workbenchState} from "../state/public-state";

export const MOVE_VIEW_COMMAND = "nbook.view.move-view";
export {OPEN_VIEW_COMMAND};

const Id = Type.String({minLength: 1, maxLength: 160});

export const VIEW_COMMAND_DECLARATIONS = {
    [OPEN_VIEW_COMMAND]: {
        category: workbenchText("categories.view"),
        description: "Show a view: show the panel it is in and activate it. Give viewId, or nothing to pick one.",
        // 会改写布局记录（活动标签、面板显隐），所以是写入；与别的布局命令一样不给 Agent。
        args: Type.Object({viewId: Type.Optional(Id)}, {additionalProperties: false}),
        effect: "write",
        expose: {agent: "never"},
        when: {requires: [workbenchState.key("layoutReady")]},
    },
    [MOVE_VIEW_COMMAND]: {
        category: workbenchText("categories.view"),
        description: "Move a view to the end of another panel's tabs (target is a panel id), or into a new panel next to one (target is {newPanelNextTo}). Give both viewId and target, or nothing to pick them.",
        args: Type.Object({
            viewId: Type.Optional(Id),
            target: Type.Optional(Type.Union([Id, Type.Object({newPanelNextTo: Id}, {additionalProperties: false})])),
        }, {additionalProperties: false}),
        effect: "write",
        expose: {agent: "never"},
        when: {requires: [workbenchState.key("layoutReady")]},
    },
} as const satisfies Readonly<Record<string, WrittenCommandDeclaration>>;

const TEXT = {
    pickView: workbenchText("viewCommands.pickView"),
    pickOpen: workbenchText("viewCommands.pickOpen"),
    noOpenable: workbenchText("viewCommands.noOpenable"),
    pickTarget: workbenchText("viewCommands.pickTarget"),
    noViews: workbenchText("viewCommands.noViews"),
    reset: workbenchText("views.resetLocation"),
    noLayout: workbenchText("layout.notOpen"),
    partial: workbenchText("viewCommands.partial"),
    stale: workbenchText("viewCommands.stale"),
    rejected: workbenchText("viewCommands.rejected"),
    limit: workbenchText("viewCommands.limit"),
} as const;

/** 选择项里“重置位置”的 id；面板 id 不会是它。 */
const RESET_ITEM = "reset:";
const NEW_PANEL_ITEM = "new:";

const DONE: CommandResult<null> = {ok: true, value: null};

function resultOf(result: LayoutResult): CommandResult<null> {
    if (result.ok) return DONE;
    if (result.code === "not-found") return {ok: false, code: "stale-target", reason: TEXT.stale};
    if (result.code === "limit-exceeded") return {ok: false, code: "unavailable", reason: TEXT.limit};
    return {ok: false, code: "invalid-args", reason: TEXT.rejected};
}

const isPlaced = (store: LayoutDocStore, viewId: string): boolean => findTab(store.actions.document(), tabKey({kind: "view", viewId})) !== null;

function targetsFor(store: LayoutDocStore, viewId: string): ReadonlyArray<MoveTarget> | null {
    const movable = store.state.catalog.get(viewId)?.movable !== false;
    return movable ? moveTargetsOf(store.actions.document(), viewId) : null;
}

async function pickAndMove(store: LayoutDocStore, quickPick: QuickPick, text: TextResolver): Promise<CommandResult<null>> {
    const {catalog} = store.state;
    const movable = [...catalog.keys()].filter((viewId) => isPlaced(store, viewId) && targetsFor(store, viewId) !== null);
    const pickedView = await quickPick.pick({
        title: TEXT.pickView,
        placeholder: TEXT.pickView,
        empty: TEXT.noViews,
        items: movable.map((viewId) => ({id: viewId, label: catalog.get(viewId)!.title})),
    });
    if (pickedView.kind === "unavailable") return {ok: false, code: "unavailable", reason: pickedView.reason};
    if (pickedView.kind !== "item") return DONE;
    // 第二步的目标表按第一步选完时的文档求。
    const targets = targetsFor(store, pickedView.id);
    if (targets === null) return {ok: false, code: "stale-target", reason: TEXT.stale};
    const pickedTarget = await quickPick.pick({
        title: TEXT.pickTarget,
        placeholder: TEXT.pickTarget,
        items: [
            ...targets.map((target) => (target.kind === "panel"
                ? {id: target.panel, label: panelTitle(store.actions.document(), catalog, target.panel)}
                : {id: `${NEW_PANEL_ITEM}${target.nextTo}`, label: workbenchText("viewCommands.newPanelNextTo", {panel: text.t(panelTitle(store.actions.document(), catalog, target.nextTo))})})),
            ...(canResetView(store.actions.document(), catalog, pickedView.id) ? [{id: RESET_ITEM, label: TEXT.reset}] : []),
        ],
    });
    if (pickedTarget.kind === "unavailable") return {ok: false, code: "unavailable", reason: pickedTarget.reason};
    if (pickedTarget.kind !== "item") return DONE;
    if (pickedTarget.id === RESET_ITEM) return resultOf(store.actions.resetView(pickedView.id));
    const target = pickedTarget.id.startsWith(NEW_PANEL_ITEM) ? {newPanelNextTo: pickedTarget.id.slice(NEW_PANEL_ITEM.length)} : pickedTarget.id;
    return resultOf(store.actions.moveView(pickedView.id, target));
}

/** 不移动焦点：成功表示布局已改，视图在下一次渲染时出现。 */
function openView(store: LayoutDocStore, viewId: string): CommandResult<null> {
    if (!store.state.catalog.has(viewId)) return {ok: false, code: "invalid-args", reason: workbenchText("viewCommands.unknownView", {viewId})};
    return resultOf(store.actions.revealView(viewId));
}

async function pickAndOpen(store: LayoutDocStore, quickPick: QuickPick): Promise<CommandResult<null>> {
    const {catalog} = store.state;
    const picked = await quickPick.pick({
        title: TEXT.pickOpen,
        placeholder: TEXT.pickOpen,
        empty: TEXT.noOpenable,
        items: [...catalog.keys()].filter((viewId) => isPlaced(store, viewId)).map((viewId) => ({id: viewId, label: catalog.get(viewId)!.title})),
    });
    if (picked.kind === "unavailable") return {ok: false, code: "unavailable", reason: picked.reason};
    if (picked.kind !== "item") return DONE;
    return openView(store, picked.id);
}

type ViewCommands = {readonly [K in keyof typeof VIEW_COMMAND_DECLARATIONS]: CommandImplementation};

export function viewCommands(layout: () => LayoutDocStore | null, quickPick: QuickPick, text: TextResolver): ViewCommands {
    return {
        [OPEN_VIEW_COMMAND]: {
            run: (raw) => {
                const store = layout();
                if (store === null) return {ok: false, code: "unavailable", reason: TEXT.noLayout};
                const {viewId} = raw as {readonly viewId?: string};
                return viewId === undefined ? pickAndOpen(store, quickPick) : openView(store, viewId);
            },
        },
        [MOVE_VIEW_COMMAND]: {
            run: (raw) => {
                const store = layout();
                if (store === null) return {ok: false, code: "unavailable", reason: TEXT.noLayout};
                const {viewId, target} = raw as {readonly viewId?: string; readonly target?: string | {readonly newPanelNextTo: string}};
                if (viewId === undefined && target === undefined) return pickAndMove(store, quickPick, text);
                if (viewId === undefined || target === undefined) return {ok: false, code: "invalid-args", reason: TEXT.partial};
                return resultOf(store.actions.moveView(viewId, target));
            },
        },
    };
}
