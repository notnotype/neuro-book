/**
 * 移动视图命令（docs/specs/workbench/commands.md 第二批，docs/specs/ui/workbench-shell.md 外壳二输出 24）：“移动到”菜单
 * 带三项参数直接执行（目标是已有容器 `targetContainerId`，或在某个 Part 新建自建容器 `newContainerIn`）；命令面板执行
 * `{}`，经选择先选视图、再选目标。实现调布局 store 的 `applyView`，合成与校验都在那里，这里只把合成结果翻成命令结果。
 *
 * 新建容器的 `custom:<UUID>` 在这次执行接纳时生成一次，保存冲突重放复用同一个（补丁里带着它）。
 *
 * 来源容器是发起时界面看到的位置：菜单打开后、或两步选择之间视图被别处移走，按 `stale-target` 拒绝且不写。
 */

import {Type} from "typebox";

import type {CommandDeclaration, CommandImplementation, CommandResult} from "nbook/plugins/commands/shared/contracts";
import type {LocalizedText} from "nbook/shared/localized-text";

import type {QuickPick} from "../../shared/contracts";
import {VIEW_LOCATIONS} from "../../shared/views";
import type {ViewLocation} from "../../shared/views";
import type {LayoutStore} from "../state/layout-store";
import {workbenchState} from "../state/public-state";
import {customContainerId} from "../views/placement";
import {moveTargetsOf} from "../views/presentation";
import type {IntentResult, ViewIntent} from "../views/intents";

export const MOVE_VIEW_COMMAND = "nbook.view.move-view";

const Id = Type.String({minLength: 1, maxLength: 160});

export const VIEW_COMMAND_DECLARATIONS = {
    [MOVE_VIEW_COMMAND]: {
        title: {"zh-CN": "移动视图", "en-US": "Move View"},
        category: {"zh-CN": "视图", "en-US": "View"},
        description: "Move a view into another existing view container (targetContainerId), or into a new container at the end of a part (newContainerIn). Give viewId, sourceContainerId and one target, or nothing to pick the view and the target.",
        args: Type.Object({
            viewId: Type.Optional(Id),
            sourceContainerId: Type.Optional(Id),
            targetContainerId: Type.Optional(Id),
            newContainerIn: Type.Optional(Type.Union(VIEW_LOCATIONS.map((part) => Type.Literal(part)))),
        }, {additionalProperties: false}),
        effect: "write",
        expose: {agent: "never"},
        when: {requires: [workbenchState.key("layoutReady")]},
    },
} as const satisfies Readonly<Record<string, CommandDeclaration>>;

export const PART_LABELS: Readonly<Record<ViewLocation, LocalizedText>> = {
    sidebar: {"zh-CN": "侧栏", "en-US": "Sidebar"},
    auxiliarybar: {"zh-CN": "右栏", "en-US": "Secondary Side Bar"},
    panel: {"zh-CN": "面板", "en-US": "Panel"},
};

const TEXT = {
    pickView: {"zh-CN": "选择要移动的视图", "en-US": "Pick a view to move"},
    pickTarget: {"zh-CN": "移动到", "en-US": "Move to"},
    noViews: {"zh-CN": "没有可以移动的视图", "en-US": "No view can be moved"},
    reset: {"zh-CN": "重置位置", "en-US": "Reset Location"},
    newContainer: {"zh-CN": "新建容器（在{part}）", "en-US": "New Container in {part}"},
    noLayout: "工作台布局没有打开（这个窗口没有显示外壳）",
    partial: "要么都不给，要么给 viewId、sourceContainerId 和 targetContainerId、newContainerIn 中的一个",
    stale: "视图已经不在发起时的容器里，没有移动",
} as const;

/** 选择项里“重置位置”与“新建容器（在 X）”的 id；容器 id 不会以它们开头。 */
const RESET_ITEM = "reset:";
const NEW_ITEM = "new:";

const DONE: CommandResult<null> = {ok: true, value: null};

/** “新建容器（在 X）”的标题，菜单与选择共用。 */
export function newContainerLabel(part: ViewLocation): LocalizedText {
    return {
        "zh-CN": TEXT.newContainer["zh-CN"].replace("{part}", PART_LABELS[part]["zh-CN"]),
        "en-US": TEXT.newContainer["en-US"].replace("{part}", PART_LABELS[part]["en-US"]),
    };
}

type MoveTarget = {readonly targetContainerId: string} | {readonly newContainerIn: ViewLocation};

/** 移动意图：新建容器时在这里生成身份。 */
function moveIntent(viewId: string, sourceContainerId: string, target: MoveTarget): ViewIntent {
    if ("targetContainerId" in target) return {kind: "move-view", viewId, sourceContainerId, targetContainerId: target.targetContainerId};
    return {kind: "detach-view", viewId, sourceContainerId, containerId: customContainerId(crypto.randomUUID()), targetPart: target.newContainerIn};
}

/** 合成结果 → 命令结果。来源变了是过期的发起，其余拒绝是参数不对。 */
function resultOf(result: IntentResult): CommandResult<null> {
    if (result.kind !== "rejected") return DONE;
    if (result.code === "stale-source") return {ok: false, code: "stale-target", reason: TEXT.stale};
    return {ok: false, code: "invalid-args", reason: result.reason};
}

async function pickAndMove(store: LayoutStore, quickPick: QuickPick): Promise<CommandResult<null>> {
    const {catalog, placement, presentation} = store.state;
    const movable = [...catalog.keys()].filter((viewId) => {
        const targets = moveTargetsOf(presentation, placement, catalog, viewId);
        return targets !== null && (targets.groups.length > 0 || targets.canReset);
    });
    const containerTitle = (containerId: string): LocalizedText | undefined => presentation.containers.get(containerId)?.title;
    const pickedView = await quickPick.pick({
        title: TEXT.pickView,
        placeholder: TEXT.pickView,
        empty: TEXT.noViews,
        items: movable.map((viewId) => {
            const source = placement.views.get(viewId)!.container;
            const title = containerTitle(source);
            return {id: viewId, label: catalog.get(viewId)!.title, ...(title === undefined ? {} : {detail: title})};
        }),
    });
    if (pickedView.kind === "unavailable") return {ok: false, code: "unavailable", reason: pickedView.reason};
    if (pickedView.kind !== "item") return DONE;
    // 第二步的目标表按第一步选完时的呈现求；来源随它一起记下，执行时再核对。
    const targets = moveTargetsOf(store.state.presentation, store.state.placement, store.state.catalog, pickedView.id);
    if (targets === null) return {ok: false, code: "stale-target", reason: TEXT.stale};
    const pickedTarget = await quickPick.pick({
        title: TEXT.pickTarget,
        placeholder: TEXT.pickTarget,
        items: [
            ...targets.groups.flatMap((group) => [
                ...group.targets.map((target) => ({id: target.containerId, label: target.title, detail: PART_LABELS[group.part]})),
                {id: `${NEW_ITEM}${group.part}`, label: newContainerLabel(group.part)},
            ]),
            ...(targets.canReset ? [{id: RESET_ITEM, label: TEXT.reset}] : []),
        ],
    });
    if (pickedTarget.kind === "unavailable") return {ok: false, code: "unavailable", reason: pickedTarget.reason};
    if (pickedTarget.kind !== "item") return DONE;
    if (store.state.placement.views.get(targets.viewId)?.container !== targets.sourceContainerId) return {ok: false, code: "stale-target", reason: TEXT.stale};
    if (pickedTarget.id === RESET_ITEM) return resultOf(store.actions.applyView({kind: "reset-view", viewId: targets.viewId}));
    const part = VIEW_LOCATIONS.find((location) => pickedTarget.id === `${NEW_ITEM}${location}`);
    return resultOf(store.actions.applyView(moveIntent(targets.viewId, targets.sourceContainerId, part === undefined ? {targetContainerId: pickedTarget.id} : {newContainerIn: part})));
}

type ViewCommands = {readonly [K in keyof typeof VIEW_COMMAND_DECLARATIONS]: CommandImplementation};

export function viewCommands(layout: () => LayoutStore | null, quickPick: QuickPick): ViewCommands {
    return {
        [MOVE_VIEW_COMMAND]: {
            run: (raw) => {
                const store = layout();
                if (store === null) return {ok: false, code: "unavailable", reason: TEXT.noLayout};
                const args = raw as {readonly viewId?: string; readonly sourceContainerId?: string; readonly targetContainerId?: string; readonly newContainerIn?: ViewLocation};
                const given = [args.viewId, args.sourceContainerId, args.targetContainerId, args.newContainerIn].filter((value) => value !== undefined).length;
                if (given === 0) return pickAndMove(store, quickPick);
                if (given !== 3 || args.viewId === undefined || args.sourceContainerId === undefined) return {ok: false, code: "invalid-args", reason: TEXT.partial};
                const target: MoveTarget = args.targetContainerId === undefined ? {newContainerIn: args.newContainerIn!} : {targetContainerId: args.targetContainerId};
                return resultOf(store.actions.applyView(moveIntent(args.viewId, args.sourceContainerId, target)));
            },
        },
    };
}
