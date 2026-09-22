import {
    AIMessage,
    AppendingSet,
    Fragment,
    HistorySet,
    If,
    Message,
    ProfilePrompt,
    Reminder,
    System,
    ToolCall,
    ToolResult,
    type ProfileChild,
    type ProfileNode,
} from "./nodes.js";

type Props = Record<string, unknown> & {readonly children?: ProfileChild | readonly ProfileChild[]};
type Component = (props: Props) => ProfileNode;

const components: Readonly<Record<string, Component>> = {
    ProfilePrompt: (props) => ProfilePrompt({children: props.children}),
    System: (props) => System({children: props.children}),
    HistorySet: (props) => HistorySet({kind: props.kind as "messages" | "tool-results" | undefined, children: props.children}),
    AppendingSet: (props) => AppendingSet({children: props.children}),
    Message: (props) => Message({role: props.role as "user" | "assistant" | undefined, children: props.children}),
    AIMessage: (props) => AIMessage({children: props.children}),
    ToolCall: (props) => ToolCall({callId: typeof props.callId === "string" ? props.callId : undefined, children: props.children}),
    ToolResult: (props) => ToolResult({callId: typeof props.callId === "string" ? props.callId : undefined, children: props.children}),
    Reminder: (props) => Reminder({children: props.children}),
    If: (props) => If({when: props.when === true, children: props.children}),
    Fragment: (props) => Fragment({children: props.children}),
};

/** JSX 工厂：函数类型直接调用，字符串元素名在 DSL 组件表里查。 */
export function createElement(type: string | Component, props: Props): ProfileNode {
    if (typeof type === "function") return type(props);
    const component = components[type];
    if (component === undefined) {
        throw new Error(`未知 profile DSL 节点：${type}`);
    }
    return component(props);
}

export const jsx = createElement;
export const jsxs = createElement;
export {Fragment};

/** JSX 类型入口：`jsxImportSource` 指向本模块时由 tsc 读取。 */
export namespace JSX {
    export type Element = ProfileNode;
    export interface IntrinsicElements {
        readonly [name: string]: Readonly<Record<string, unknown>>;
    }
    export interface ElementChildrenAttribute {
        readonly children: Record<string, unknown>;
    }
}
