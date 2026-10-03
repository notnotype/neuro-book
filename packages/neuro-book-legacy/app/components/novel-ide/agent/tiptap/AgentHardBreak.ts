import {HardBreak} from "@tiptap/extension-hard-break";

/**
 * Agent 输入器中的换行直接序列化为 \n，避免聊天输入出现 Markdown 硬换行空格。
 */
export const AgentHardBreak = HardBreak.extend({
    renderMarkdown: () => "\n",
});
