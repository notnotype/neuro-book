import {markRaw, shallowRef, type Component} from "vue";
import type {ChatNode, AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import type {
    AgentBubbleDefinition,
    AgentBubbleMeta,
    AgentBubbleRenderMode,
} from "./bubble-contract";

/**
 * 气泡扩展注册中心。
 * 允许外部功能模块动态注册气泡渲染器，支持 text 节点与 tool 节点的模式匹配。
 */
class BubbleRegistry {
    private readonly definitions = shallowRef<AgentBubbleDefinition[]>([]);
    private readonly toolNameToBubbleId = new Map<string, string>();

    /**
     * 注册新的气泡定义。
     * 后注册的定义优先级更高（放在前面优先匹配）。
     */
    register(definition: AgentBubbleDefinition): void {
        const existingIndex = this.definitions.value.findIndex((d) => d.id === definition.id);
        const next = [...this.definitions.value];
        if (existingIndex >= 0) {
            next.splice(existingIndex, 1);
        }
        next.unshift({
            ...definition,
            component: markRaw(definition.component),
        });
        this.definitions.value = next;
    }

    /**
     * 为 tool 名字快速绑定气泡定义。
     */
    bindTool(toolName: string, definition: AgentBubbleDefinition): void {
        this.register(definition);
        this.toolNameToBubbleId.set(toolName, definition.id);
    }

    /**
     * 根据当前 ChatNode 节点匹配对应的气泡定义。
     */
    resolve(node: ChatNode): AgentBubbleDefinition | null {
        // 如果是 tool 节点且有精准绑定的 bubbleId，快速查找
        if (node.kind === "tool") {
            const boundId = this.toolNameToBubbleId.get(node.toolCall.name);
            if (boundId) {
                const found = this.definitions.value.find((d) => d.id === boundId);
                if (found) return found;
            }
        }

        // 顺序匹配 matcher
        for (const def of this.definitions.value) {
            if (def.match(node)) {
                return def;
            }
        }
        return null;
    }

    /**
     * 获取所有已登记的气泡定义（只读）。
     */
    getAll(): readonly AgentBubbleDefinition[] {
        return this.definitions.value;
    }
}

export const bubbleRegistry = new BubbleRegistry();

/**
 * 外部扩展接入 API：注册新气泡。
 */
export function registerBubble(definition: AgentBubbleDefinition): void {
    bubbleRegistry.register(definition);
}

/**
 * 匹配节点气泡定义。
 */
export function resolveBubble(node: ChatNode): AgentBubbleDefinition | null {
    return bubbleRegistry.resolve(node);
}
