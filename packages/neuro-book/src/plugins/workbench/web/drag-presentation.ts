/**
 * 拖动中画什么（docs/specs/ui/workbench-layout.md 输出 30、38）：把手势的落点和实时布局的状态翻译成外壳要画的东西。纯函数，文字和坐标留在外壳。
 *
 * 要不要卡片、什么时候换预览是 `LiveDrag` 的状态机定的，这里不再判断一次。
 */

import {findTab} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutDropAction, LayoutSource} from "@notnotype/nb-layout";

import type {LayoutDragDrop, LayoutDragSectors, LayoutDropPreview} from "./layout-drag";

export interface DragPresentationInput {
    /** 这一场是实时布局。 */
    readonly live: boolean;
    readonly source: LayoutSource | null;
    /** 手势此刻的落点；资源树的文件拖动是它那一场的落点。 */
    readonly drop: LayoutDragDrop | null;
    /** 卡片拿着。 */
    readonly lifted: boolean;
    /** 已显示的落点动作；预览的是别的时为 null。 */
    readonly shownAction: LayoutDropAction | null;
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
    /** 要不要跟手的拖影：拿着卡片时卡片就是。 */
    readonly ghost: boolean;
    /** 预览里来源落进去的新块：空位，什么都不画。 */
    readonly slotPanel: string | null;
    /** 并入的目标：盖一层。 */
    readonly mergeTarget: string | null;
    /** 分区：实时布局画在卡片后面，落点指示画在反馈层。 */
    readonly liveSectors: LayoutDragSectors | null;
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
    return {
        placeholder: liveTab,
        ghost: source !== null && !lifted,
        slotPanel: shownAction?.kind === "edge" ? landing : null,
        // 中央的预览把来源摘掉了，目标里没有它；来源本来就在这块是放回原处，不是并入。
        mergeTarget: liveTab !== null && shownAction?.kind === "center" && landing !== shownAction.panel ? shownAction.panel : null,
        liveSectors: live ? sectors : null,
        feedbackSectors: live ? null : sectors,
        feedback: feedbackOf(input),
    };
}
