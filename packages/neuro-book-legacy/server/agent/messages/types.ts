import type {AgentMessage, AgentTool, AgentToolCall, ThinkingLevel} from "@earendil-works/pi-agent-core";
import type {AssistantMessage, ImageContent, Message, Model, TextContent, Tool, ToolResultMessage, Usage, UserMessage} from "@earendil-works/pi-ai";

export type {
    AgentMessage,
    AgentTool,
    AgentToolCall,
    AssistantMessage,
    ImageContent,
    Message,
    Model,
    TextContent,
    Tool,
    ThinkingLevel,
    ToolResultMessage,
    Usage,
    UserMessage,
};

/**
 * v3 运行时可持久化的 JSON 值。
 */
export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | {[key: string]: JsonValue};

/** Agent 用户输入。图片通过正文 Markdown 标记引用 Session Attachment。 */
export type AgentUserMessageInput = {
    text: string;
};
