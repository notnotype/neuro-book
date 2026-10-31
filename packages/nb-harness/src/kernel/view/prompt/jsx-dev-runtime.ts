/** 开发模式的 JSX 运行时：与 `jsx-runtime.ts` 相同，忽略源码位置。 */

import type {PromptComponent, PromptNode} from "../../api/index.js";
import {jsx} from "./jsx-runtime.js";

export {Fragment, JSX} from "./jsx-runtime.js";

export function jsxDEV<P>(type: PromptComponent<P>, props: P): PromptNode {
    return jsx(type, props);
}
