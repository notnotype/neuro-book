/**
 * 节点：TSX 产生的普通数据，与内置节点的组件函数。节点一律冻结，渲染函数拿到的是只读树。
 */

import type {JsonValue, ProfileChild, ProfileNode} from "./types";

export const BUILTIN = {
    prompt: "harness/prompt",
    system: "harness/system",
    history: "harness/history",
    appending: "harness/appending",
    input: "harness/input",
    user: "harness/user",
    developer: "harness/developer",
    assistant: "harness/assistant",
    reminder: "harness/reminder",
    tag: "harness/tag",
    image: "harness/image",
    fragment: "harness/fragment",
} as const;

/** 布局节点与 Fragment 由本模块固定，不经注册表（Spec“布局节点”与 reserved-node）。 */
export const LAYOUT_IDS: ReadonlySet<string> = new Set([BUILTIN.prompt, BUILTIN.system, BUILTIN.history, BUILTIN.appending, BUILTIN.input]);
export const RESERVED_IDS: ReadonlySet<string> = new Set([...LAYOUT_IDS, BUILTIN.fragment]);

/** 子节点归一化只在这里做一次：数组拍平，null、undefined、布尔值丢掉，数字转字符串。 */
export function normalizeChildren(raw: unknown): ProfileChild[] {
    const out: ProfileChild[] = [];
    const visit = (value: unknown): void => {
        if (value === null || value === undefined || typeof value === "boolean") return;
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
        } else if (typeof value === "string") {
            if (value !== "") out.push(value);
        } else if (typeof value === "number" || typeof value === "bigint") {
            out.push(String(value));
        } else if (isNode(value)) {
            out.push(value);
        } else {
            throw new TypeError(`Profile 节点的子节点只能是节点或文字，收到 ${typeof value}`);
        }
    };
    visit(raw);
    return out;
}

export function isNode(value: unknown): value is ProfileNode {
    return typeof value === "object" && value !== null && typeof (value as {type?: unknown}).type === "string" && Array.isArray((value as {children?: unknown}).children);
}

export function createNode(type: string, props: Record<string, unknown> = {}): ProfileNode {
    const {children, ...rest} = props;
    return Object.freeze({type, props: Object.freeze({...rest}), children: Object.freeze(normalizeChildren(children))});
}

type WithChildren<P> = P & {readonly children?: unknown};

/** 给注册方用：由节点类型 id 造出 TSX 组件函数。 */
export function nodeComponent<P extends object = Record<never, never>>(id: string): (props: WithChildren<P>) => ProfileNode {
    return (props) => createNode(id, props as Record<string, unknown>);
}

export type MessageProps = {once?: boolean};
export type HistoryProps = {last?: number; as?: "text"};
export type ReminderProps = {id: string; when?: boolean; every?: number; watch?: JsonValue; once?: boolean};
export type TagProps = {name: string};
export type ImageProps = {mimeType: string; data: string};

export const Prompt = nodeComponent(BUILTIN.prompt);
export const System = nodeComponent(BUILTIN.system);
export const History = nodeComponent<HistoryProps>(BUILTIN.history);
export const Appending = nodeComponent(BUILTIN.appending);
export const Input = nodeComponent(BUILTIN.input);
export const User = nodeComponent<MessageProps>(BUILTIN.user);
export const Developer = nodeComponent<MessageProps>(BUILTIN.developer);
export const Assistant = nodeComponent(BUILTIN.assistant);
export const Reminder = nodeComponent<ReminderProps>(BUILTIN.reminder);
export const Tag = nodeComponent<TagProps>(BUILTIN.tag);
export const Image = nodeComponent<ImageProps>(BUILTIN.image);
export const Fragment = nodeComponent(BUILTIN.fragment);
