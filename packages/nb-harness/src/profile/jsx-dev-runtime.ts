/** 开发态 JSX 运行时：Bun 在非 production 下走这里；忽略 key、isStaticChildren、source、self 等调试参数。 */

import {jsx} from "./jsx-runtime";
import {Fragment} from "./nodes";
import type {ProfileNode} from "./types";

export function jsxDEV(type: unknown, props: Parameters<typeof jsx>[1], ..._rest: readonly unknown[]): ProfileNode {
    return jsx(type, props);
}

export {jsx, jsxDEV as jsxs, Fragment};
export type {JSX} from "./jsx-runtime";
