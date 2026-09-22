/** profile 树的子节点：节点、字符串、空值或它们的数组。 */
export type ProfileChild = ProfileNode | string | null | undefined | false | readonly ProfileChild[];

/** profile DSL 的节点：`kind` 决定渲染语义，`props` 保存声明参数，`children` 是树的子节点。 */
export interface ProfileNode {
    readonly kind: string;
    readonly props: Readonly<Record<string, unknown>>;
    readonly children: readonly ProfileChild[];
}

/** 历史消息：由宿主（harness）注入给 `HistorySet`/`ToolCall`/`ToolResult`。 */
export interface ProfileRenderMessage {
    readonly role: "user" | "assistant" | "tool";
    readonly text: string;
    readonly callId?: string;
}

export interface ProfileRenderInput {
    readonly messages: readonly ProfileRenderMessage[];
    readonly now?: () => Date;
}

export interface RenderedProfile {
    readonly systemPrompt: readonly string[];
    readonly messages: readonly ProfileRenderMessage[];
}

function normalizeChildren(children: ProfileChild | readonly ProfileChild[] | undefined): readonly ProfileChild[] {
    if (children === undefined) return [];
    return Array.isArray(children) ? (children as readonly ProfileChild[]) : [children as ProfileChild];
}

function createNode(kind: string, props: Readonly<Record<string, unknown>> = {}): ProfileNode {
    return {kind, props, children: normalizeChildren(props.children as ProfileChild | readonly ProfileChild[] | undefined)};
}

export function Fragment(props: {readonly children?: ProfileChild | readonly ProfileChild[]}): ProfileNode {
    return createNode("Fragment", props);
}

export function ProfilePrompt(props: {readonly children?: ProfileChild | readonly ProfileChild[]}): ProfileNode {
    return createNode("ProfilePrompt", props);
}

export function System(props: {readonly children?: ProfileChild | readonly ProfileChild[]}): ProfileNode {
    return createNode("System", props);
}

export function HistorySet(props: {readonly kind?: "messages" | "tool-results"; readonly children?: ProfileChild | readonly ProfileChild[]}): ProfileNode {
    return createNode("HistorySet", props);
}

export function AppendingSet(props: {readonly children?: ProfileChild | readonly ProfileChild[]}): ProfileNode {
    return createNode("AppendingSet", props);
}

export function Message(props: {readonly role?: "user" | "assistant"; readonly children?: ProfileChild | readonly ProfileChild[]}): ProfileNode {
    return createNode("Message", props);
}

export function AIMessage(props: {readonly children?: ProfileChild | readonly ProfileChild[]}): ProfileNode {
    return createNode("AIMessage", props);
}

export function ToolCall(props: {readonly callId?: string; readonly children?: ProfileChild | readonly ProfileChild[]}): ProfileNode {
    return createNode("ToolCall", props);
}

export function ToolResult(props: {readonly callId?: string; readonly children?: ProfileChild | readonly ProfileChild[]}): ProfileNode {
    return createNode("ToolResult", props);
}

export function Reminder(props: {readonly children?: ProfileChild | readonly ProfileChild[]}): ProfileNode {
    return createNode("Reminder", props);
}

export function If(props: {readonly when: boolean; readonly children?: ProfileChild | readonly ProfileChild[]}): ProfileNode {
    return createNode("If", props);
}

/** 运行时可识别的节点判定（供 loader 校验默认导出）。 */
export function isProfileNode(value: unknown): value is ProfileNode {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as ProfileNode;
    return typeof candidate.kind === "string" && Array.isArray(candidate.children);
}
