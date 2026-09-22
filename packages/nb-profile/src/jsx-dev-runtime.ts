import {createElement, Fragment} from "./jsx-runtime.js";
import type {ProfileNode} from "./nodes.js";

/**
 * 开发态 JSX 工厂：Bun 在非 production 下走 `jsx-dev-runtime`。
 * 忽略 `key`/`isStaticChildren`/`source`/`self` 等调试参数。
 */
export function jsxDEV(
    type: Parameters<typeof createElement>[0],
    props: Parameters<typeof createElement>[1],
    ..._rest: readonly unknown[]
): ProfileNode {
    return createElement(type, props);
}

export const jsx = jsxDEV;
export const jsxs = jsxDEV;
export {Fragment};

/** 与 `jsx-runtime` 同形的类型入口，供 `jsx: "react-jsxdev"` 的消费方使用。 */
export namespace JSX {
    export type Element = ProfileNode;
    export interface IntrinsicElements {
        readonly [name: string]: Readonly<Record<string, unknown>>;
    }
    export interface ElementChildrenAttribute {
        readonly children: Record<string, unknown>;
    }
}
