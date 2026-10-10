/**
 * JSX 运行时（`jsxImportSource: "@notnotype/nb-harness/profile"`）。只接受函数类型的元素：没有“内置 HTML 元素”这一层，
 * 每个节点都对应一个组件函数（内置的或注册方用 `nodeComponent` 造的），字符串元素名直接报错。
 */

import {Fragment} from "./nodes";
import type {ProfileNode} from "./types";

type Props = Record<string, unknown> & {readonly children?: unknown};
type Component = (props: Props) => ProfileNode;

export function jsx(type: unknown, props: Props, _key?: unknown): ProfileNode {
    if (typeof type !== "function") throw new TypeError(`Profile 的 JSX 元素必须是组件函数，收到 ${typeof type === "string" ? `<${type}>` : typeof type}`);
    return (type as Component)(props);
}

export const jsxs = jsx;
export {Fragment};

export namespace JSX {
    export type Element = ProfileNode;
    // 为空：禁止 <div> 这类字符串元素，所有节点都经组件函数。
    export interface IntrinsicElements {}
    export interface ElementChildrenAttribute {
        children: unknown;
    }
}
