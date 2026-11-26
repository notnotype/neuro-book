/**
 * 失败的构造（库内用，不从入口导出）。每层一张“码 → `params` 形状”的映射，构造时按映射检查：
 * 拼错字段名、漏字段、给了没有 `params` 的码传参，都在编译期报错。导出的类型仍是通用的 `GridFailure`
 * （Spec `ui/nested-grid` 失败 5 到 7），映射不进公开类型。
 *
 * 一个码有几种形状的写成按 `field` 判别的联合：同一个码下靠 `field` 区分“哪一项不合法”，测试按它断言。
 */
import type {GridFailure, GridParamValue} from "./grid-types";

type ParamsMap = Record<string, Readonly<Record<string, GridParamValue>> | undefined>;

/** 节点、子节点哪一侧的尺寸不合法：手势的基线还是目标。 */
type GridSizeSide = "baseline" | "target";

/** 结构操作（Spec 失败 5）。 */
export type GridFailureParams = {
    "not-found": {id: string};
    "wrong-node-kind": {id: string; expected: "leaf" | "branch"};
    "wrong-axis": {id: string; orientation: string} | {id: string; parent: string; orientation: string};
    "not-finite":
        | {field: "delta" | "ratio"; value: string}
        | {field: "size"; side: GridSizeSide; id: string}
        | {field: "intent" | "px"; id: string};
    "invalid-argument":
        | {field: "root" | "sizes-cover" | "fixed-cross-axis" | "px-negative"; id: string}
        | {field: "size-negative"; side: GridSizeSide; id: string}
        | {field: "orientation" | "side" | "ratio-range"; value: string};
    "limit-exceeded": {limit: "nodes" | "depth"; max: number};
    "duplicate-id": {id: string; with: "existing" | "new-leaf"};
    "into-own-subtree": {id: string; parent: string};
    "not-conserved": {id: string; target: number; baseline: number};
    "stale-baseline": {id: string};
    "not-collapsible": {id: string; branch: string};
    "collapse-locked": {id: string; branch: string};
    "wrong-sizing": {id: string; expected: "fixed" | "weight"};
};

/** 快照恢复（Spec 失败 7）。 */
export type GridRestoreFailureParams = {
    // 外壳、非对象节点、缺 id 的节点拿不到 id；其余几项都是某个节点的问题，必须带它的 id。
    "invalid-snapshot": {field: "envelope" | "node" | "id"} | {field: "ref" | "size" | "orientation" | "children" | "kind"; id: string};
    "unsupported-version": {version: string};
    "unresolved-root": undefined;
    "duplicate-id": {id: string; with: "existing"};
    "limit-exceeded": {limit: "nodes" | "depth"; max: number};
};

/** 提交（Spec 失败 6）：结构操作的码原样转交，另加提交自己的。 */
export type GridCommitFailureParams = GridFailureParams & {
    "not-ready": {missing: "grid" | "host-size"};
    "stale-context": {expected: string; actual: string};
    "stale-revision": {expected: number; actual: number};
    "stale-size": undefined;
    "handler-missing": undefined;
    "handler-threw": undefined;
};

function failureFor<M extends ParamsMap>() {
    return <C extends keyof M & string>(code: C, message: string, ...params: M[C] extends undefined ? [] : [M[C]]): GridFailure<C> =>
        params.length === 0 ? {ok: false, code, message} : {ok: false, code, message, params: params[0] as Readonly<Record<string, GridParamValue>>};
}

export const gridFailure = failureFor<GridFailureParams>();
export const restoreFailure = failureFor<GridRestoreFailureParams>();
export const commitFailure = failureFor<GridCommitFailureParams>();
