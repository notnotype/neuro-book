/**
 * 诊断的构造（库内用，不从入口导出）。一张“码 → `params` 形状”的映射，构造时按映射检查：拼错字段名、漏字段、
 * 给了没有 `params` 的码传参，都在编译期报错。导出的类型只有通用的 `GridIssue`（Spec `ui/nested-grid` 输出 139）。
 *
 * 一个码有几种形状的写成按 `cause` 判别的联合。度量参数取两位小数（同 `grid-geometry` 的 `round`），
 * 和 `message` 里的数一致，交给宿主的翻译端口时不带浮点尾巴。
 */
import type {GridAxis, GridHostIssueCode, GridIssue, GridIssueCode, GridParamValue} from "./grid-types";

type Measured = {id: string; axis: GridAxis; available: number; required: number};

export type GridIssueParams = {
    "over-constrained":
        | ({cause: "min-total" | "fixed-overflow" | "leaf-min" | "sash-overflow" | "cross-min"} & Measured)
        // 拖动的有效范围装不下分支总量：独立的 `Splitter` 不知道自己在哪个分支，`id` 与 `axis` 由会话给。
        // `max` 只在所有面板都有上限时给（不设上限的上限是哨兵值，合计没有意义）。
        | {cause: "range-overflow"; id: string; axis: GridAxis; total: number; min: number; max?: number}
        | {cause: "range-overflow"; total: number; min: number; max?: number};
    "unabsorbed-space": {cause: "no-weight" | "capped"; id: string; axis: GridAxis; rest: number};
    "conflicting-bounds": {id: string; axis: GridAxis; min: number; max: number};
    "no-collapse-policy": {id: string};
    "no-room-to-collapse": {id: string};
    "no-room-to-restore": {id: string; available: number; required: number};
    "swap-skipped": {cause: "no-leaving" | "no-entering"} | {cause: "busy"; id: string};
    "not-published": undefined;
    "notify-failed": undefined;
};

type IssueCode = GridIssueCode | GridHostIssueCode;

function metric(value: GridParamValue): GridParamValue {
    return typeof value === "number" ? Math.round(value * 100) / 100 : value;
}

export function gridIssue<C extends IssueCode>(code: C, message: string, ...params: GridIssueParams[C] extends undefined ? [] : [GridIssueParams[C]]): GridIssue<C> {
    if (params.length === 0) {
        return {code, message};
    }
    const rounded: Record<string, GridParamValue> = {};
    for (const [key, value] of Object.entries(params[0] as Readonly<Record<string, GridParamValue | undefined>>)) {
        // 可选的度量不给时就没有这个键，不留值为 undefined 的键（日志与翻译端口都只认字符串与数字）。
        if (value !== undefined) {
            rounded[key] = metric(value);
        }
    }
    return {code, message, params: rounded};
}
