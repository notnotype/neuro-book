/**
 * 模板渲染：把 Profile 的模板（`PromptNode` 树）算成系统块与消息（提案第 8 节；规则见 harness 的 Profile Spec）。
 *
 * 容器（`<System>`、`<User>`、`<Assistant>`）里每个子节点是一块；行内的 `<P>`、`<Tag>` 把子节点直接相连成一块。
 * 块之间怎样分段由适配器决定（相邻的文字块之间空一行）。`<System />` 自闭合时放 Profile 的 `system`。
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

export interface Rendered {
    readonly system: readonly RequestBlock[];
    readonly messages: readonly Message[];
    /** `<Turn />` 出现的次数（必须恰好一次，调用方报诊断）。 */
    readonly turnNodes: number;
    readonly placedSlots: ReadonlySet<string>;
}

const PROFILE = {kind: "fixed", by: "profile"} as const;

export function renderTemplate(template: PromptChild, input: RenderInput): Rendered {
    const system: RequestBlock[] = [];
    const messages: Message[] = [];
    const placed = new Set<string>();
    let turnNodes = 0;

    /** 先找出模板里按名字摆放的槽：`*` 只收其余的，不管它写在前面还是后面。 */
    const explicitlyPlaced = new Set<string>();
    const scan = (child: PromptChild): void => {
        if (Array.isArray(child)) return child.forEach(scan);
        if (!isNode(child)) return;
        if (child.type === Slot && (child.props as {name: string}).name !== "*") explicitlyPlaced.add((child.props as {name: string}).name);
        child.children.forEach(scan);
    };
    scan(template);

    /** `<Slot>` 的块：按名字的，或 `*` 收没被单独摆放的（按稳定与否）。 */
    const slotBlocks = (props: {name: string; stable?: boolean; volatile?: boolean; drop?: boolean}): RequestBlock[] => {
        if (props.name !== "*") {
            placed.add(props.name);
            if (props.drop === true) return [];
            return input.slots.filter((slot) => slot.name === props.name).map((slot) => ({kind: "text", text: slot.text, origin: {kind: "slot", name: slot.name, extension: slot.extension}}));
        }
        const wantVolatile = props.volatile === true;
        return input.slots
            .filter((slot) => slot.volatile === wantVolatile && !explicitlyPlaced.has(slot.name))
            .map((slot) => {
                placed.add(slot.name);
                return {kind: "text", text: slot.text, origin: {kind: "slot", name: slot.name, extension: slot.extension}} as RequestBlock;
            });
    };

    /** 行内：子节点直接相连成一段文字。 */
    const inline = (children: readonly PromptChild[]): string => children.map((child) => {
        if (child === null || child === undefined || child === false || child === true) return "";
        if (typeof child === "string" || typeof child === "number") return String(child);
        if (Array.isArray(child)) return inline(child);
        const node = child as PromptNode;
        if (node.type === ToolName) {
            const id = (node.props as {id: string}).id;
            const tool = input.tools.find((item) => item.id === id);
            return tool === undefined ? providerToolName({id}) : providerToolName(tool);
        }
        if (node.type === Tag) return tagText(node);
        if (node.type === If) return input.tools.some((tool) => tool.id === (node.props as {tool: string}).tool) ? inline(node.children) : "";
        return inline(node.children);
    }).join("");

    const tagText = (node: PromptNode): string => {
        const props = node.props as {name: string; attrs?: Record<string, string>};
        const attrs = Object.entries(props.attrs ?? {}).map(([key, value]) => ` ${key}="${value}"`).join("");
        return `<${props.name}${attrs}>${inline(node.children)}</${props.name}>`;
    };

    /** 容器里的块。 */
    const blocks = (children: readonly PromptChild[], inSystem: boolean): RequestBlock[] => children.flatMap((child): RequestBlock[] => {
        if (child === null || child === undefined || child === false || child === true || child === "") return [];
        if (typeof child === "string" || typeof child === "number") return [{kind: "text", text: String(child), origin: PROFILE}];
        if (Array.isArray(child)) return blocks(child, inSystem);
        const node = child as PromptNode;
        if (node.type === Slot) return slotBlocks(node.props as {name: string});
        if (node.type === System && inSystem && node.children.length === 0) return blocks([input.system], inSystem);
        if (node.type === If) return input.tools.some((tool) => tool.id === (node.props as {tool: string}).tool) ? blocks(node.children, inSystem) : [];
        if (node.type === Fragment) return blocks(node.children, inSystem);
        const text = node.type === Tag ? tagText(node) : inline([node]);
        return text === "" ? [] : [{kind: "text", text, origin: PROFILE}];
    });

    const push = (message: Message | null) => {
        if (message !== null && message.content.length + (message.toolCalls?.length ?? 0) > 0) messages.push(message);
    };

    const top = (child: PromptChild): void => {
        if (child === null || child === undefined || child === false || child === true) return;
        if (Array.isArray(child)) return child.forEach(top);
        if (typeof child === "string" || typeof child === "number") {
            push({role: "user", content: [{kind: "text", text: String(child), origin: PROFILE}]});
            return;
        }
        const node = child as PromptNode;
        if (node.type === Fragment) return node.children.forEach(top);
        if (node.type === System) {
            system.push(...blocks(node.children.length === 0 ? [input.system] : node.children, true));
            return;
        }
        if (node.type === User) return push({role: "user", content: blocks(node.children, false)});
        if (node.type === Assistant) return push({role: "assistant", content: blocks(node.children, false)});
        if (node.type === History) return input.history((node.props as {last?: number}).last).forEach(push);
        if (node.type === Turn) {
            turnNodes += 1;
            return input.turn().forEach(push);
        }
        if (node.type === Slot) return push({role: "user", content: slotBlocks(node.props as {name: string})});
        if (node.type === If) {
            if (input.tools.some((tool) => tool.id === (node.props as {tool: string}).tool)) node.children.forEach(top);
            return;
        }
        push({role: "user", content: blocks([node], false)});
    };
    top(template);
    return {system, messages, turnNodes, placedSlots: placed};
}
