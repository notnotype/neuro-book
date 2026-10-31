/**
 * 模板节点：每个组件只记下自己的属性与子节点，渲染（文字拼法、槽、`<Turn />` 的个数检查）在视图里做。
 * 组件函数本身就是节点的 `type`，渲染按引用分派，不按名字。
 */

import type {PromptChild, PromptComponent, PromptComponents, PromptNode} from "../../api/index.js";

/** 子节点摊平成一层：数组与 Fragment 都展开。 */
export function flattenChildren(children: PromptChild): PromptChild[] {
    if (Array.isArray(children)) return children.flatMap((child: PromptChild) => flattenChildren(child));
    if (isNode(children) && children.type === Fragment) return [...children.children];
    return [children];
}

export function isNode(value: unknown): value is PromptNode {
    return typeof value === "object" && value !== null && !Array.isArray(value) && "type" in value && "props" in value && "children" in value;
}

/** `name` 只为调试与诊断里显示得出是哪个节点；渲染按引用分派。 */
function component<P extends object>(name: string): PromptComponent<P> {
    const self: PromptComponent<P> = (props) => {
        const {children, ...rest} = props as P & {children?: PromptChild};
        return {type: self, props: rest, children: children === undefined ? [] : flattenChildren(children)};
    };
    Object.defineProperty(self, "name", {value: name});
    return self;
}

export const System: PromptComponents["System"] = component("System");
export const User: PromptComponents["User"] = component("User");
export const Assistant: PromptComponents["Assistant"] = component("Assistant");
export const P: PromptComponents["P"] = component("P");
export const Tag: PromptComponents["Tag"] = component("Tag");
export const If: PromptComponents["If"] = component("If");
export const ToolName: PromptComponents["ToolName"] = component("ToolName");
export const History: PromptComponents["History"] = component("History");
export const Turn: PromptComponents["Turn"] = component("Turn");
export const Slot: PromptComponents["Slot"] = component("Slot");
export const Fragment: PromptComponents["Fragment"] = component("Fragment");
