/**
 * 视图命令（docs/specs/ui/workbench-layout.md 输出 23、35，docs/specs/workbench/views.md 输出 14）。打开视图：显示它所在的面板、激活；不给 `viewId` 时经选择挑一个。
 * 移动视图（commands.md 的 `move-view`）：分节标题与浮动窗视图标签的“移动到”带 `{viewId, container}`（容器 id）或 `{viewId, newContainerIn}`（区域名）直接执行；
 * 命令面板执行 `{}`，经选择先选视图、再选目标，第二步的目标表与菜单同一份（`moveTargetsFor`）。
 *
 * 选择之间目标容器没了（没有成员也没有声明），按 `stale-target` 拒绝且不写。
 */

import {findTab} from "@notnotype/nb-workbench-layout";
import type {LayoutResult} from "@notnotype/nb-workbench-layout";
import {Type} from "typebox";

import type {CommandImplementation, CommandResult, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import type {DisplayText} from "nbook/shared/localized-text";

import type {QuickPick} from "../../shared/contracts";
import {workbenchText} from "../../shared/text";
import {OPEN_VIEW_COMMAND, VIEW_LOCATIONS} from "../../shared/views";
import type {ViewLocation} from "../../shared/views";
import type {LayoutDocStore, MoveViewTarget} from "../state/layout-doc-store";
import {moveTargetsOf, viewKey} from "../state/layout-present";
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
        description: "Move a view into another view container as its last section (container: a container id), or into a new container of its own in an area (newContainerIn: sidebar, auxiliarybar or panel). Give viewId and one of those, or nothing to pick them.",
        args: Type.Object({
            viewId: Type.Optional(Id),
            container: Type.Optional(Id),
            newContainerIn: Type.Optional(Type.Union(VIEW_LOCATIONS.map((region) => Type.Literal(region)))),
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

/** 选择项的 id 按种类加前缀：容器 id 是插件给的，不能让它和别的种类撞。 */
const CONTAINER_ITEM = "container:";
const NEW_CONTAINER_ITEM = "new:";
const RESET_ITEM = "reset:";

/** “新容器（某区域）”的名字（输出 23）。 */
const NEW_CONTAINER_TEXT: Readonly<Record<ViewLocation, DisplayText>> = {
    sidebar: workbenchText("viewCommands.newContainerIn.sidebar"),
    auxiliarybar: workbenchText("viewCommands.newContainerIn.auxiliarybar"),
    panel: workbenchText("viewCommands.newContainerIn.panel"),
};

/** 目标表的一项在选择里的 id、名字，和执行时交给 store 的目标；菜单（`WorkbenchShell.vue`）用同一份。 */
export function moveTargetItem(target: MoveTarget): {readonly id: string; readonly label: DisplayText; readonly args: MoveViewTarget} {
    if (target.kind === "container") return {id: `${CONTAINER_ITEM}${target.container}`, label: target.label.title, args: {container: target.container}};
    if (target.kind === "new-container") return {id: `${NEW_CONTAINER_ITEM}${target.region}`, label: NEW_CONTAINER_TEXT[target.region], args: {newContainerIn: target.region}};
    return {id: `${RESET_ITEM}${target.container}`, label: TEXT.reset, args: {container: target.container}};
}

const DONE: CommandResult<null> = {ok: true, value: null};

function resultOf(result: LayoutResult): CommandResult<null> {
    if (result.ok) return DONE;
    if (result.code === "not-found") return {ok: false, code: "stale-target", reason: TEXT.stale};
    if (result.code === "limit-exceeded") return {ok: false, code: "unavailable", reason: TEXT.limit};
    return {ok: false, code: "invalid-args", reason: TEXT.rejected};
}

const isPlaced = (store: LayoutDocStore, viewId: string): boolean => findTab(store.actions.document(), viewKey(viewId)) !== null;

/**
 * 这个视图此刻的“移动到”目标（输出 23），菜单（`WorkbenchShell.vue`）与命令面板第二步读同一份：目标表里此刻提交会被拒的（位置限制，views.md 输出 22）不列。
 * 视图不让移动、不在文档里时是 null。
 */
export function moveTargetsFor(store: LayoutDocStore, viewId: string): ReadonlyArray<MoveTarget> | null {
    return candidateTargets(store, viewId)?.filter((target) => store.actions.permitsMoveView(viewId, moveTargetItem(target).args)) ?? null;
}

const candidateTargets = (store: LayoutDocStore, viewId: string): ReadonlyArray<MoveTarget> | null =>
    store.state.catalog.get(viewId)?.movable === false ? null : moveTargetsOf(store.actions.document(), viewId, store.state.catalog, store.state.containers);

/** 命令面板第一步只要知道有没有一个会被收下的目标：每个目标都是一次整份文档的试算，找到一个就停（几十个视图时逐个全算要上秒）。 */
const hasMoveTarget = (store: LayoutDocStore, viewId: string): boolean => candidateTargets(store, viewId)?.some((target) => store.actions.permitsMoveView(viewId, moveTargetItem(target).args)) === true;

async function pickAndMove(store: LayoutDocStore, quickPick: QuickPick): Promise<CommandResult<null>> {
    const {catalog} = store.state;
    const movable = [...catalog.keys()].filter((viewId) => isPlaced(store, viewId) && hasMoveTarget(store, viewId));
    const pickedView = await quickPick.pick({
        title: TEXT.pickView,
        placeholder: TEXT.pickView,
        empty: TEXT.noViews,
        items: movable.map((viewId) => ({id: viewId, label: catalog.get(viewId)!.title})),
    });
    if (pickedView.kind === "unavailable") return {ok: false, code: "unavailable", reason: pickedView.reason};
    if (pickedView.kind !== "item") return DONE;
    // 第二步的目标表按第一步选完时的文档求。
    const targets = moveTargetsFor(store, pickedView.id);
    if (targets === null) return {ok: false, code: "stale-target", reason: TEXT.stale};
    const items = targets.map(moveTargetItem);
    const pickedTarget = await quickPick.pick({
        title: TEXT.pickTarget,
        placeholder: TEXT.pickTarget,
        items: items.map(({id, label}) => ({id, label})),
    });
    if (pickedTarget.kind === "unavailable") return {ok: false, code: "unavailable", reason: pickedTarget.reason};
    if (pickedTarget.kind !== "item") return DONE;
    const chosen = items.find((item) => item.id === pickedTarget.id);
    if (chosen === undefined) return DONE;
    // 第二步期间布局可能又变了：store 按执行这一刻的文档重验，容器没了是 stale-target。
    return resultOf(store.actions.moveView(pickedView.id, chosen.args));
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

export function viewCommands(layout: () => LayoutDocStore | null, quickPick: QuickPick): ViewCommands {
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
                const {viewId, container, newContainerIn} = raw as {readonly viewId?: string; readonly container?: string; readonly newContainerIn?: ViewLocation};
                if (viewId === undefined && container === undefined && newContainerIn === undefined) return pickAndMove(store, quickPick);
                // 两个目标互斥：都给时说不清要哪个，只给一部分时缺了要动谁或去哪。
                if (viewId === undefined || (container === undefined) === (newContainerIn === undefined)) return {ok: false, code: "invalid-args", reason: TEXT.partial};
                return resultOf(store.actions.moveView(viewId, container === undefined ? {newContainerIn: newContainerIn as ViewLocation} : {container}));
            },
        },
    };
}
