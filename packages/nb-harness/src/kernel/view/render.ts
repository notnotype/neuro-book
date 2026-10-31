/**
 * 模板渲染：把 Profile 的模板（`PromptNode` 树）算成系统块与消息。规则见 docs/specs/harness/profile.md 输出 1–5、15、16。
 *
 * 三种位置：顶层（每个节点是一条消息或一段历史）、容器（`<System>`、`<User>`、`<Assistant>` 里，每个子节点一块）、
 * 行内（`<P>`、`<Tag>` 里，子节点直接相连成一段文字）。节点放错位置抛 `TemplateError`，这次请求算不出来。
 *
 * 槽分两步：先扫一遍模板（连同 Profile 的 `system`）记下按名字提到的槽，`<Slot name="*">` 只收没被提到的；
 * 被提到、但所在的 `<If>` 没渲染的槽不算“没摆”，作者已经决定了它的位置。
 */

import type {Message, PromptChild, PromptNode, RequestBlock, ToolInfo} from "../api/index.js";
import {providerToolName} from "../api/index.js";
import {Assistant, Fragment, History, If, isNode, P, Slot, System, Tag, ToolName, Turn, User} from "./prompt/nodes.js";

/** 一个槽这次的内容：每个交内容的扩展一块，按装配序。 */
export interface SlotContent {
    readonly name: string;
    readonly extension: string;
    readonly volatile: boolean;
    readonly text: string;
}

export interface RenderInput {
    readonly system: PromptChild;
    readonly tools: readonly ToolInfo[];
    readonly slots: readonly SlotContent[];
    readonly history: (last: number | undefined) => readonly (Message | null)[];
    readonly turn: () => readonly (Message | null)[];
}

export interface SlotProblem {
    readonly code: "slot-unplaced" | "slot-volatile-in-system";
    readonly slot: string;
    readonly extension: string;
}

export interface Rendered {
    readonly system: readonly RequestBlock[];
    readonly messages: readonly Message[];
    readonly slotProblems: readonly SlotProblem[];
    /** 这次真正渲染进请求的槽贡献（预览的槽报告用）。 */
    readonly placed: ReadonlySet<SlotContent>;
}

/** 模板结构不合规：`<Turn />` 不是恰好一个，或节点放错了位置。 */
export class TemplateError extends Error {
    constructor(readonly code: "template-invalid" | "turn-node-count", message: string) {
        super(message);
        this.name = "TemplateError";
    }
}

type SlotProps = {name: string; stable?: boolean; volatile?: boolean; drop?: boolean};
type Where = "system" | "user" | "assistant";

const PROFILE = {kind: "fixed", by: "profile"} as const;

function nodeName(node: PromptNode): string {
    return `<${node.type.name || "?"}>`;
}

function escapeAttribute(value: string): string {
    return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

export function renderTemplate(template: PromptChild, input: RenderInput): Rendered {
    const system: RequestBlock[] = [];
    const messages: Message[] = [];
    const slotProblems: SlotProblem[] = [];
    /** 被 `<Slot name="*">` 收走的贡献（按贡献算：同一个槽名可以有稳定的、也有会变的）。 */
    const caught = new Set<SlotContent>();
    const placedSlots = new Set<SlotContent>();
    let turnNodes = 0;

    const mentioned = new Set<string>();
    let placesSystem = false;
    const scan = (child: PromptChild): void => {
        if (Array.isArray(child)) return child.forEach(scan);
        if (!isNode(child)) return;
        if (child.type === Slot && (child.props as SlotProps).name !== "*") mentioned.add((child.props as SlotProps).name);
        if (child.type === System && child.children.length === 0) placesSystem = true;
        child.children.forEach(scan);
    };
    scan(template);
    // Profile 的 `system` 只在模板里有 `<System />` 时才渲染；没有时它里面的槽不算摆放过。
    if (placesSystem) scan(input.system);

    const hasTool = (node: PromptNode) => input.tools.some((tool) => tool.id === (node.props as {tool: string}).tool);
    const slotBlock = (slot: SlotContent): RequestBlock => ({kind: "text", text: slot.text, origin: {kind: "slot", name: slot.name, extension: slot.extension}});

    const slotBlocks = (props: SlotProps, where: Where | "top"): RequestBlock[] => {
        let picked: SlotContent[];
        if (props.name !== "*") {
            if (props.drop === true) return [];
            picked = input.slots.filter((slot) => slot.name === props.name);
        } else {
            const wantVolatile = props.volatile === true;
            picked = input.slots.filter((slot) => slot.volatile === wantVolatile && !mentioned.has(slot.name));
            for (const slot of picked) caught.add(slot);
        }
        if (where === "system") for (const slot of picked) if (slot.volatile) slotProblems.push({code: "slot-volatile-in-system", slot: slot.name, extension: slot.extension});
        for (const slot of picked) placedSlots.add(slot);
        return picked.map(slotBlock);
    };

    const misplaced = (node: PromptNode, where: string): never => {
        throw new TemplateError("template-invalid", `${nodeName(node)} cannot be placed ${where}`);
    };

    /** 行内：子节点直接相连成一段文字。 */
    const inline = (children: readonly PromptChild[]): string => children.map((child): string => {
        if (child === null || child === undefined || child === false || child === true) return "";
        if (typeof child === "string" || typeof child === "number") return String(child);
        if (Array.isArray(child)) return inline(child);
        const node = child as PromptNode;
        if (node.type === ToolName) {
            const id = (node.props as {id: string}).id;
            return providerToolName(input.tools.find((tool) => tool.id === id) ?? {id});
        }
        if (node.type === Tag) {
            const props = node.props as {name: string; attrs?: Readonly<Record<string, string>>};
            const attrs = Object.entries(props.attrs ?? {}).map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`).join("");
            return `<${props.name}${attrs}>${inline(node.children)}</${props.name}>`;
        }
        if (node.type === If) return hasTool(node) ? inline(node.children) : "";
        if (node.type === P || node.type === Fragment) return inline(node.children);
        return misplaced(node, "inside <P> or <Tag>");
    }).join("");

    /** 容器里的块。`profileSystem` 防止 Profile 的 `system` 里再写 `<System />` 无限展开。 */
    const blocks = (children: readonly PromptChild[], where: Where, profileSystem: boolean): RequestBlock[] => children.flatMap((child): RequestBlock[] => {
        if (child === null || child === undefined || child === false || child === true || child === "") return [];
        if (typeof child === "string" || typeof child === "number") return [{kind: "text", text: String(child), origin: PROFILE}];
        if (Array.isArray(child)) return blocks(child, where, profileSystem);
        const node = child as PromptNode;
        if (node.type === Slot) return slotBlocks(node.props as SlotProps, where);
        if (node.type === Fragment) return blocks(node.children, where, profileSystem);
        if (node.type === If) return hasTool(node) ? blocks(node.children, where, profileSystem) : [];
        if (node.type === System && node.children.length === 0 && where === "system" && !profileSystem) return blocks([input.system], where, true);
        if (node.type === P || node.type === Tag || node.type === ToolName) {
            const text = inline([node]);
            return text === "" ? [] : [{kind: "text", text, origin: PROFILE}];
        }
        return misplaced(node, `inside <${where === "system" ? "System" : where === "user" ? "User" : "Assistant"}>${profileSystem ? " (in the profile's system)" : ""}`);
    });

    const push = (message: Message | null) => {
        if (message === null) return;
        const content = message.content.filter((block) => block.kind !== "text" || block.text !== "");
        if (content.length + (message.toolCalls?.length ?? 0) === 0 && message.role !== "tool") return;
        messages.push(content.length === message.content.length ? message : {...message, content});
    };

    const top = (child: PromptChild): void => {
        if (child === null || child === undefined || child === false || child === true) return;
        if (Array.isArray(child)) return child.forEach(top);
        if (typeof child === "string" || typeof child === "number") return push({role: "user", content: [{kind: "text", text: String(child), origin: PROFILE}]});
        const node = child as PromptNode;
        if (node.type === Fragment) return node.children.forEach(top);
        if (node.type === If) {
            if (hasTool(node)) node.children.forEach(top);
            return;
        }
        if (node.type === System) {
            system.push(...(node.children.length === 0 ? blocks([input.system], "system", true) : blocks(node.children, "system", false)));
            return;
        }
        if (node.type === User) return push({role: "user", content: blocks(node.children, "user", false)});
        if (node.type === Assistant) return push({role: "assistant", content: blocks(node.children, "assistant", false)});
        if (node.type === History) return input.history((node.props as {last?: number}).last).forEach(push);
        if (node.type === Turn) {
            turnNodes += 1;
            return input.turn().forEach(push);
        }
        if (node.type === Slot) return push({role: "user", content: slotBlocks(node.props as SlotProps, "top")});
        if (node.type === P || node.type === Tag || node.type === ToolName) return push({role: "user", content: [{kind: "text", text: inline([node]), origin: PROFILE}]});
        misplaced(node, "at the top level");
    };
    top(template);
    if (turnNodes !== 1) throw new TemplateError("turn-node-count", `the template has ${turnNodes} <Turn /> nodes; it must have exactly one`);

    for (const slot of input.slots) {
        if (mentioned.has(slot.name) || caught.has(slot)) continue;
        slotProblems.push({code: "slot-unplaced", slot: slot.name, extension: slot.extension});
    }
    return {system, messages, slotProblems, placed: placedSlots};
}
