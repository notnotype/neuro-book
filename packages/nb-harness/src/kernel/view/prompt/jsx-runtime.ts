/**
 * JSX 自动运行时：`jsxImportSource: "@notnotype/nb-harness/prompt"`。只有组件函数，没有内置的小写元素。
 */

import type {PromptComponent, PromptNode} from "../../api/index.js";
import {Fragment} from "./nodes.js";

export {Fragment};

export function jsx<P>(type: PromptComponent<P>, props: P): PromptNode {
    return type(props);
}
export const jsxs = jsx;

export namespace JSX {
    export type Element = PromptNode;
    export interface IntrinsicElements {}
    export interface ElementChildrenAttribute {
        children: {};
    }
}
