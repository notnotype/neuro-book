import type {ProfileChild, ProfileNode, ProfileRenderInput, ProfileRenderMessage, RenderedProfile} from "./nodes.js";

/** 连续空行折叠成一个空行，并去掉首尾空白。 */
function collapseBlankLines(text: string): string {
    return text.replace(/\n{3,}/gu, "\n\n").trim();
}

/** 把一棵子树的文本子节点按换行拼接成段落（`If` 在拼接阶段同样生效）。 */
export function collectText(children: readonly ProfileChild[]): string {
    const parts: string[] = [];
    const walk = (nodes: readonly ProfileChild[]): void => {
        for (const child of nodes) {
            if (child === null || child === undefined || child === false) continue;
            if (typeof child === "string") {
                parts.push(child);
                continue;
            }
            if (Array.isArray(child)) {
                walk(child as readonly ProfileChild[]);
                continue;
            }
            const node = child as ProfileNode;
            if (node.kind === "If") {
                if (node.props.when !== true) continue;
                walk(node.children);
                continue;
            }
            walk(node.children);
        }
    };
    walk(children);
    return collapseBlankLines(parts.join("\n"));
}

function lookupCallId(node: ProfileNode, messages: readonly ProfileRenderMessage[]): ProfileRenderMessage | undefined {
    const callId = node.props.callId;
    if (typeof callId !== "string" || callId === "") return undefined;
    return messages.find((message) => message.callId === callId);
}

/**
 * 渲染 profile 树：`System`/`Reminder` 段落进 `systemPrompt`，消息类节点按文档顺序进 `messages`。
 * 纯函数：不读环境、不读文件、不改输入。
 */
export function renderProfile(node: ProfileNode, input: ProfileRenderInput): RenderedProfile {
    const systemPrompt: string[] = [];
    const messages: ProfileRenderMessage[] = [];

    const walkAll = (children: readonly ProfileChild[]): void => {
        for (const child of children) {
            if (child === null || child === undefined || child === false) continue;
            if (typeof child === "string") continue;
            if (Array.isArray(child)) {
                walkAll(child as readonly ProfileChild[]);
                continue;
            }
            walk(child as ProfileNode);
        }
    };

    const walk = (current: ProfileNode): void => {
        switch (current.kind) {
            case "ProfilePrompt":
            case "Fragment":
            case "AppendingSet":
                walkAll(current.children);
                return;
            case "System":
            case "Reminder": {
                const text = collectText(current.children);
                if (text !== "") systemPrompt.push(text);
                return;
            }
            case "HistorySet": {
                const onlyToolResults = current.props.kind === "tool-results";
                for (const message of input.messages) {
                    if (onlyToolResults && message.role !== "tool") continue;
                    messages.push(message);
                }
                return;
            }
            case "Message": {
                messages.push({
                    role: current.props.role === "assistant" ? "assistant" : "user",
                    text: collectText(current.children),
                });
                return;
            }
            case "AIMessage": {
                messages.push({role: "assistant", text: collectText(current.children)});
                return;
            }
            case "ToolCall":
            case "ToolResult": {
                const found = lookupCallId(current, input.messages);
                if (found !== undefined) messages.push(found);
                return;
            }
            case "If": {
                if (current.props.when === true) walkAll(current.children);
                return;
            }
            default:
                walkAll(current.children);
                return;
        }
    };

    walk(node);
    return {systemPrompt, messages};
}
