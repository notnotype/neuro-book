/**
 * 拖动中画什么（docs/specs/ui/workbench-layout.md 输出 30、38）：把手势的落点和实时布局的状态翻译成外壳要画的东西。纯函数，文字和坐标留在外壳。
 *
 * 要不要卡片、什么时候换预览是 `LiveDrag` 的状态机定的，这里不再判断一次。
 */

import {findTab} from "@notnotype/nb-layout";
import type {LayoutDoc} from "@notnotype/nb-layout";

import {dropStripOf} from "./entry-drop";
import type {WorkbenchDragSource, WorkbenchDropAction} from "./entry-drop";
import type {LayoutDragDrop, LayoutDragSectors, LayoutDropPreview} from "./layout-drag";

export interface DragPresentationInput {
    /** 这一场是实时布局。 */
    readonly live: boolean;
    readonly source: WorkbenchDragSource | null;
    /** 手势此刻的落点；资源树的文件拖动是它那一场的落点。 */
    readonly drop: LayoutDragDrop | null;
    /** 卡片拿着。 */
    readonly lifted: boolean;
    /** 已显示的落点动作；预览的是别的时为 null。 */
    readonly shownAction: WorkbenchDropAction | null;
    /** 画出来的文档。 */
    readonly rendered: LayoutDoc;
    /** 指针在面板上但放不进去。 */
    readonly rejected: boolean;
}

export interface DragFeedback {
    /** 落点指示要画的插入线或区域。 */
    readonly preview: LayoutDropPreview | null;
    /** 反馈层写这个落点的文字。 */
    readonly label: LayoutDragDrop | null;
    /** 读屏与卡片头写这个落点的文字（实时布局：反馈就是布局本身）。 */
    readonly announce: LayoutDragDrop | "rejected" | null;
    /** 动作种类，写给探针读。 */
    readonly kind: string;
}

export interface DragPresentation {
    /** 留着位置、看不见的标签：它正被拖着。 */
    readonly placeholder: string | null;
    /** 要不要跟手的拖影：拿着卡片时卡片就是；在标签条里排序时标签自己就是。 */
    readonly ghost: boolean;
    /** 空位，什么都不画：预览里来源落进去的新块，或拿起的标签是它唯一的标签的那块面板。 */
    readonly slotPanel: string | null;
    /** 并入的目标：盖一层。 */
    readonly mergeTarget: string | null;
    /** 并入的活动栏入口（容器 id）：入口上盖同一种高亮（输出 45）。只在实时布局：那里入口上不吸收、也没有落点指示，只有它表示落点；落点指示由反馈层框出入口（`entryRect`），和中央一样不叠两层。 */
    readonly mergeEntry: string | null;
    /** 分区：只有落点指示画。实时布局的预览就是反馈；分区画在判定用的布局上，预览一摆目标就挪了，对不上。 */
    readonly feedbackSectors: LayoutDragSectors | null;
    readonly feedback: DragFeedback;
}

const NO_FEEDBACK: DragFeedback = {preview: null, label: null, announce: null, kind: ""};

function feedbackOf({live, source, drop, rejected}: DragPresentationInput): DragFeedback {
    if (drop === null) return rejected ? {...NO_FEEDBACK, announce: "rejected"} : NO_FEEDBACK;
    // 整窗在移动：窗本身就是反馈。
    if (source?.kind === "panel" && drop.action.kind === "float") return {...NO_FEEDBACK, kind: "float"};
    const kind = drop.inPlace ? "noop" : drop.action.kind;
    return live ? {...NO_FEEDBACK, announce: drop, kind} : {preview: drop.preview, label: drop, announce: null, kind};
}

export function presentDrag(input: DragPresentationInput): DragPresentation {
    const {live, source, drop, lifted, shownAction, rendered} = input;
    const tab = source?.kind === "tab" ? source.tab : null;
    const liveTab = live ? tab : null;
    const landing = liveTab === null ? null : (findTab(rendered, liveTab)?.panel ?? null);
    const sectors = drop?.sectors ?? null;
    // 卡片收回、指针在标签条上（活动栏的入口之间也是）：被拖的标签自己在条里跟手（`placeSorted`），不要拖影。
    const sorting = liveTab !== null && !lifted && drop !== null && dropStripOf(drop.action) !== null;
    return {
        placeholder: liveTab,
        ghost: source !== null && !lifted && !sorting,
        // 拿起的是这块面板唯一的标签：它的头（只写标题、或只剩这一个标签）也跟着走，原位是空位，直到来源收起。
        slotPanel: shownAction?.kind === "edge" || (lifted && landing !== null && rendered.panels[landing]?.tabs.length === 1) ? landing : null,
        // 中央的预览把来源摘掉了，目标里没有它；来源本来就在这块是放回原处，不是并入。
        mergeTarget: liveTab !== null && shownAction?.kind === "center" && landing !== shownAction.panel ? shownAction.panel : null,
        mergeEntry: live && shownAction?.kind === "join-container" ? shownAction.container : null,
        feedbackSectors: live ? null : sectors,
        feedback: feedbackOf(input),
    };
}
