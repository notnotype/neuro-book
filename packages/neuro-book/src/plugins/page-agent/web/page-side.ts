/**
 * 窗口里页面引擎的这一侧交给浏览器入口的接口。引擎随工作台浮层（`engine/PageAgentEngine.vue`）挂在页面上；浏览器入口在后端
 * 类型检查的范围里，没有 DOM 类型，所以只经这个不带 DOM 的接口用它。
 */

import type {HighlightArgs, HighlightEnd, HighlightInstalled, Locator, PageFailure, SnapshotArgs, SnapshotResult} from "@notnotype/nb-page-agent/api";

import type {WindowInfo} from "../shared/contracts";

export interface PageSide {
    info(): WindowInfo;
    snapshot(args: SnapshotArgs): SnapshotResult | PageFailure;
    /** 这个定位此刻能不能在页面上找到（命中多个也算）。 */
    present(locator: Locator): boolean;
    /** 截视口，或 `of` 指的元素本身（docs/specs/agent/page-agent.md 输出 5、8）；写错的定位抛 `TypeError`。 */
    capture(of: Locator | undefined): Promise<CaptureOutcome>;
    /** 高亮并等用户（输出 9、10）；写错的定位抛 `TypeError`。 */
    highlight(args: HighlightArgs): PageHighlight;
}

/** 一次高亮：画出来时 `installed` resolve（没画出来就结束时是 null），撤掉之后 `outcome` resolve；`cancel` 撤掉，结局是 `cancelled`。 */
export interface PageHighlight {
    readonly installed: Promise<HighlightInstalled | null>;
    readonly outcome: Promise<HighlightEnd>;
    cancel(): void;
}

/** 截图的结果：图由浏览器入口凭服务端给的凭证上传，不经远程调用的结果。 */
export type CaptureOutcome =
    | {readonly ok: true; readonly target: "window" | "element"; readonly image: Blob; readonly width: number; readonly height: number; readonly warnings: readonly string[]}
    | PageFailure
    | {readonly ok: false; readonly code: "window-hidden" | "capture-failed"; readonly message: string};

/** 引擎挂上时交出自己，交回的函数在卸下时调用。 */
export type ConnectPage = (page: PageSide) => () => void;
