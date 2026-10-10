/**
 * 渲染（Spec 输出 5–11）：纯函数，只读 `Prepared`、历史、输入与状态。
 *
 * 文本拼接分两步：先把子节点渲染成片段（行内文字、块级文字、图片），再按规则连接——行内直接相连，块级前后空一行，
 * 整段去首尾空白、三个以上换行折叠为两个。消息内容只有文字时用字符串，有图片时用块数组。
 */

import type {AssistantMessage, ImageContent, Message, TextContent} from "@oh-my-pi/pi-ai";
import {BUILTIN} from "./nodes";
import {flatten, schemaProblems} from "./prepare";
import type {Prepared} from "./prepare";
import type {AppendedMessage, AppendingOutput, Diagnostic, JsonValue, ProfileChild, ProfileNode, ProfileState, RequestOutput, SeedOutput, UserInput} from "./types";

type Piece = {kind: "inline" | "block"; text: string} | {kind: "image"; mimeType: string; data: string};

interface RenderScope {
    readonly prepared: Prepared;
    /** 文本形式的 History 用：本次调用之前的历史。 */
    readonly historyBefore: readonly Message[];
    /** 有状态节点的状态：读旧值、写新值；不在 Appending 里渲染时为 null。 */
    readonly state: Map<string, JsonValue> | null;
    /** 渲染期的诊断：内容节点 render 返回的新节点不在准备时校验过的树里，这里按同样的规则再查一遍。 */
    readonly diagnostics: Diagnostic[];
}

/** 渲染时所在的位置：消息的角色，或 System。图片只允许出现在 User 里。 */
type Placement = {readonly role: "user" | "developer" | "assistant" | "system"; readonly parentType: string; readonly path: string};

/** 用户发出的消息开始新的一轮，与 session 分页同一规则。 */
export function startsTurn(message: Message): boolean {
    return message.role === "user" && message.attribution !== "agent" && message.synthetic !== true;
}

export function lastTurns(history: readonly Message[], count: number): readonly Message[] {
    if (count <= 0) return [];
    const starts = history.flatMap((message, index) => (index === 0 || startsTurn(message) ? [index] : []));
    const from = starts.at(-count) ?? 0;
    return history.slice(from);
}

const describeContent = (content: Message["content"]): string => {
    if (typeof content === "string") return content;
    return content
        .map((block) => {
            switch (block.type) {
                case "text":
                    return block.text;
                case "image":
                    return "[图片]";
                case "toolCall":
                    return `[调用 ${block.name} ${JSON.stringify(block.arguments)}]`;
                case "thinking":
                    return "";
                default:
                    return "";
            }
        })
        .filter((text) => text !== "")
        .join("\n");
};

/** 输出 11：每条消息一段，以角色名开头；工具调用与结果写出工具名与文本。 */
export function historyToText(history: readonly Message[]): string {
    return history
        .map((message) => (message.role === "toolResult" ? `toolResult(${message.toolName}): ${describeContent(message.content)}` : `${message.role}: ${describeContent(message.content)}`))
        .join("\n\n");
}

function renderPieces(children: readonly ProfileChild[], scope: RenderScope, placement: Placement, pieces: Piece[] = []): Piece[] {
    for (const child of flatten(children)) {
        if (typeof child === "string") {
            pieces.push({kind: "inline", text: child});
            continue;
        }
        if (child === null) continue;
        renderNodePieces(child, scope, placement, pieces);
    }
    return pieces;
}

function warn(scope: RenderScope, code: Diagnostic["code"], path: string, detail: string): void {
    scope.diagnostics.push({severity: "warning", code, path, detail});
}

/** 内容节点 render 返回的节点不在准备时校验过的树里：这里按同样的规则（已注册、props、父子、图片位置）再查，不合的丢掉并给诊断。 */
function renderNodePieces(node: ProfileNode, scope: RenderScope, placement: Placement, pieces: Piece[]): void {
    const path = `${placement.path}>${node.type}`;
    if (node.type === BUILTIN.history) {
        const last = typeof node.props.last === "number" ? node.props.last : undefined;
        const history = last === undefined ? scope.historyBefore : lastTurns(scope.historyBefore, last);
        pieces.push({kind: "inline", text: historyToText(history)});
        return;
    }
    if (node.type === BUILTIN.image) {
        if (placement.role !== "user") {
            warn(scope, "image-not-allowed", path, `图片只能放在 User 里，这里是 ${placement.role}；已丢弃`);
            return;
        }
        pieces.push({kind: "image", mimeType: node.props.mimeType as string, data: node.props.data as string});
        return;
    }
    const definition = scope.prepared.nodeTypes.get(node.type);
    if (definition === undefined) {
        warn(scope, "unknown-node", path, `没有注册节点类型 ${node.type}；已丢弃`);
        return;
    }
    if (definition.category === "message") {
        warn(scope, "invalid-child", path, `消息节点不能出现在 ${placement.parentType} 的内容里；已丢弃`);
        return;
    }
    const props = schemaProblems(definition.props, node.props);
    if (props !== null) {
        warn(scope, "invalid-props", path, `${props}；已丢弃`);
        return;
    }
    const parentDefinition = scope.prepared.nodeTypes.get(placement.parentType);
    const accepted = definition.parents.includes(placement.parentType) || (parentDefinition !== undefined && definition.parents.includes(`*${parentDefinition.category}`));
    if (!accepted) {
        warn(scope, "invalid-parent", path, `${node.type} 不能放在 ${placement.parentType} 里；已丢弃`);
        return;
    }
    const context = {prompt: scope.prepared.context, sources: sourcesFor(scope.prepared, definition.sources ?? [])};
    let content: ProfileChild;
    if (definition.category === "stateful") {
        const id = node.props.id as string;
        const result = definition.render(node, {...context, state: scope.state?.get(id)});
        scope.state?.set(id, result.state);
        content = result.content;
    } else {
        content = definition.render(node, context);
    }
    const inner = renderPieces(content === null ? [] : [content], scope, {role: placement.role, parentType: node.type, path});
    if (definition.category === "content" && definition.layout === "block") pieces.push({kind: "block", text: joinPieces(inner.filter((piece): piece is Extract<Piece, {kind: "inline" | "block"}> => piece.kind !== "image"))});
    else pieces.push(...inner);
}

function sourcesFor(prepared: Prepared, ids: readonly string[]): Readonly<Record<string, unknown>> {
    return Object.freeze(Object.fromEntries(ids.map((id) => [id, prepared.sources.get(id)])));
}

/** 输出 5 的连接规则。 */
export function joinPieces(pieces: readonly Extract<Piece, {kind: "inline" | "block"}>[]): string {
    let text = "";
    for (const piece of pieces) text += piece.kind === "block" ? `\n\n${piece.text}\n\n` : piece.text;
    // 行尾的空格、制表符一并去掉：块级前后的空行不该带着上一行的尾随空白。行首的缩进保留，那可能是内容的一部分。
    return text.replace(/[ \t]+\n/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
}

function toContent(pieces: readonly Piece[]): string | (TextContent | ImageContent)[] {
    if (!pieces.some((piece) => piece.kind === "image")) return joinPieces(pieces as Extract<Piece, {kind: "inline" | "block"}>[]);
    const blocks: (TextContent | ImageContent)[] = [];
    let run: Extract<Piece, {kind: "inline" | "block"}>[] = [];
    const flush = (): void => {
        const text = joinPieces(run);
        if (text !== "") blocks.push({type: "text", text});
        run = [];
    };
    for (const piece of pieces) {
        if (piece.kind === "image") {
            flush();
            blocks.push({type: "image", mimeType: piece.mimeType, data: piece.data});
        } else {
            run.push(piece);
        }
    }
    flush();
    return blocks;
}

const ZERO_USAGE = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}};

function messageOf(role: "user" | "developer" | "assistant", content: string | (TextContent | ImageContent)[], timestamp: number): Message {
    if (role === "assistant") {
        // Profile 里写的助手消息是示例，不来自任何模型；pi-ai 的必填字段填占位值。
        const blocks = typeof content === "string" ? [{type: "text" as const, text: content}] : content;
        const assistant: AssistantMessage = {role: "assistant", content: blocks, api: "profile", provider: "profile", model: "profile", usage: ZERO_USAGE, stopReason: "stop", timestamp};
        return assistant;
    }
    return {role, content, timestamp};
}

function renderMessage(node: ProfileNode, scope: RenderScope, path: string): Message {
    const definition = scope.prepared.nodeTypes.get(node.type) as {role: "user" | "developer" | "assistant"};
    return messageOf(definition.role, toContent(renderPieces(node.children, scope, {role: definition.role, parentType: node.type, path})), scope.prepared.nowMs);
}

const isMessageNode = (prepared: Prepared, node: ProfileNode): boolean => prepared.nodeTypes.get(node.type)?.category === "message";

const scopeOf = (prepared: Prepared, historyBefore: readonly Message[], state: Map<string, JsonValue> | null): RenderScope => ({prepared, historyBefore, state, diagnostics: []});

export function renderSystem(prepared: Prepared): {systemPrompt: string[]; diagnostics: Diagnostic[]} {
    const scope = scopeOf(prepared, [], null);
    const systemPrompt = prepared.order
        .filter((child) => child.kind === "system")
        .map(({node}, index) => joinPieces(renderPieces(node.children, scope, {role: "system", parentType: BUILTIN.system, path: `Prompt>System[${index}]`}).filter((piece): piece is Extract<Piece, {kind: "inline" | "block"}> => piece.kind !== "image")))
        .filter((text) => text !== "");
    return {systemPrompt, diagnostics: scope.diagnostics};
}

export function renderSeeds(prepared: Prepared, occasion: "new-session" | "after-compaction"): SeedOutput {
    if (prepared.seeded === null) return {messages: [], diagnostics: []};
    const scope = scopeOf(prepared, [], null);
    const messages: SeedOutput["messages"] = [];
    flatten(prepared.seeded.children).forEach((child, index) => {
        if (typeof child !== "object" || child === null || !isMessageNode(prepared, child)) return;
        const once = child.props.once === true;
        if (occasion === "after-compaction" && once) return;
        messages.push({message: renderMessage(child, scope, `Prompt>History>[${index}]`), once});
    });
    return {messages, diagnostics: scope.diagnostics};
}

export function renderAppending(prepared: Prepared, input: {input: UserInput; state: ProfileState}): AppendingOutput {
    // 状态接管为副本：输出的 state 与传入的对象脱离，调用方改任一边都不影响另一边。
    const state = new Map<string, JsonValue>(Object.entries(structuredClone(input.state)));
    const scope = scopeOf(prepared, [], state);
    const timestamp = prepared.nowMs;
    const inputMessage: AppendedMessage = {kind: "input", message: {role: "user", content: input.input.content, timestamp}};
    const messages: AppendedMessage[] = [];
    let sawInput = false;
    flatten(prepared.appending?.children ?? []).forEach((child, index) => {
        if (typeof child !== "object" || child === null) return;
        if (child.type === BUILTIN.input) {
            messages.push(inputMessage);
            sawInput = true;
        } else if (isMessageNode(prepared, child)) {
            messages.push({kind: "message", message: renderMessage(child, scope, `Prompt>Appending>[${index}]`)});
        } else if (prepared.nodeTypes.get(child.type)?.category === "stateful") {
            const pieces: Piece[] = [];
            renderNodePieces(child, scope, {role: "user", parentType: BUILTIN.appending, path: `Prompt>Appending>[${index}]`}, pieces);
            const content = toContent(pieces);
            if (content === "" || (Array.isArray(content) && content.length === 0)) return;
            messages.push({kind: child.type === BUILTIN.reminder ? "reminder" : "message", message: {role: "user", content, timestamp}});
        }
    });
    if (!sawInput) messages.push(inputMessage);
    return {messages, state: Object.fromEntries(state), diagnostics: scope.diagnostics};
}

export function renderRequest(prepared: Prepared, input: {history: readonly Message[]; invocationStart: number}): RequestOutput {
    const diagnostics: Diagnostic[] = [];
    let start = input.invocationStart;
    if (!Number.isInteger(start) || start < 0 || start > input.history.length) {
        diagnostics.push({severity: "warning", code: "invalid-invocation-start", path: "Prompt", detail: `invocationStart ${String(input.invocationStart)} 不在 0 到 ${input.history.length} 之间，按 ${input.history.length} 处理`});
        start = input.history.length;
    }
    const scope = scopeOf(prepared, input.history.slice(0, start), null);
    scope.diagnostics.push(...diagnostics);
    const messages: Message[] = [];
    let sawHistory = false;
    for (const child of prepared.order) {
        if (child.kind === "history") {
            sawHistory = true;
            const last = typeof child.node.props.last === "number" ? child.node.props.last : undefined;
            messages.push(...(last === undefined ? input.history : lastTurns(input.history, last)));
        } else if (child.kind === "message") {
            messages.push(renderMessage(child.node, scope, `Prompt>${child.node.type}`));
        }
    }
    if (!sawHistory) messages.push(...input.history.slice(start));
    const system = renderSystem(prepared);
    return {systemPrompt: system.systemPrompt, messages, diagnostics: [...scope.diagnostics, ...system.diagnostics]};
}
