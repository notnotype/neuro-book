/**
 * 视图段的工作台一端（docs/specs/workbench/views.md 输出 21）：外壳持有的控制。外壳按已提交的位置、容器与代际写 `placement` 与 `expanded`，
 * 视图的 `request` 转给外壳给的处理函数。视图拿到的那一端（`ViewRail`、`viewRailOf`）在共用合同里，见 `shared/contracts.ts` 的“视图段”。
 */

import {ref, shallowRef} from "vue";

import {attachViewRail} from "../../shared/contracts";
import type {ViewRail, ViewRailRequestResult} from "../../shared/contracts";
import type {ViewContext} from "../contracts";

/** 侧轨给视图段的两个位置：工作台自己按元素用；交给视图时就是共用合同的 `ViewRailPlacement`。 */
export type RailPlacement =
    | {readonly kind: "rail"; readonly main: HTMLElement; readonly foot: HTMLElement; readonly width: number; readonly tooNarrow: boolean}
    | {readonly kind: "window"; readonly width: number; readonly tooNarrow: boolean}
    | {readonly kind: "none"};

/** 外壳持有的一端：分发借用时写 `setPlacement`、生效的展开状态写 `setExpanded`；换代或删实例时 `retire`。 */
export interface ViewRailControl {
    readonly rail: ViewRail;
    readonly placement: () => RailPlacement;
    setPlacement(placement: RailPlacement): void;
    setExpanded(expanded: boolean): void;
    /** 这一份不再是当前的：位置改成 `none`，之后的请求一律 `revoked`。 */
    retire(): void;
}

const NONE: RailPlacement = {kind: "none"};

function samePlacement(current: RailPlacement, next: RailPlacement): boolean {
    if (current.kind === "none" || next.kind === "none") return current.kind === next.kind;
    if (current.width !== next.width || current.tooNarrow !== next.tooNarrow) return false;
    if (current.kind === "rail") return next.kind === "rail" && current.main === next.main && current.foot === next.foot;
    return next.kind === "window";
}

/**
 * 每一代上下文一份。`request` 交给 `handle`（外壳：按此刻已提交的文档判、提交记录），这一份已退休时直接 `revoked`、不调 `handle`。
 * 连续请求按调用顺序各自完成：`handle` 是同步判定、同步提交的，每次调用拿到的都是前一次提交之后的文档。
 */
export function createViewRail(context: ViewContext, handle: (expanded: boolean) => ViewRailRequestResult): ViewRailControl {
    const placement = shallowRef<RailPlacement>(NONE);
    const expanded = ref(false);
    let retired = false;
    const rail: ViewRail = {
        placement,
        expanded,
        // 构造函数里同步调 `handle`（同步判定、同步提交，按调用顺序），它抛错时交回失败的 Promise，不在视图的调用处同步抛。
        request: (wanted) => new Promise((resolve) => resolve(retired ? "revoked" : handle(wanted))),
    };
    attachViewRail(context, rail);
    return {
        rail,
        placement: () => placement.value,
        setPlacement: (next) => {
            if (retired) return;
            // 同样的值再写一次不换引用，视图不跟着重算。
            if (!samePlacement(placement.value, next)) placement.value = next;
        },
        setExpanded: (next) => {
            if (!retired) expanded.value = next;
        },
        retire: () => {
            retired = true;
            placement.value = NONE;
            expanded.value = false;
        },
    };
}
