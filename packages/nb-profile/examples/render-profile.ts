/**
 * 加载 `.profile.tsx` 并渲染；再用函数调用构造一棵带 `If` 的树，对比条件开关的结果。
 *
 * 运行：bun examples/render-profile.ts
 */
import {resolve} from "node:path";
import {If, loadProfile, Message, ProfilePrompt, renderProfile, System, ToolResult, type ProfileRenderMessage} from "@notnotype/nb-profile";

const history: readonly ProfileRenderMessage[] = [
    {role: "user", text: "把第三段改得更紧凑。"},
    {role: "tool", text: "1: 第三段原文……", callId: "call-1"},
    {role: "assistant", text: "已压缩为两句。"},
];

// 1. 从文件加载：Bun 直接执行 TSX，默认导出必须是 Profile 节点。
const loaded = await loadProfile(resolve(import.meta.dir, "assistant.profile.tsx"));
const fromFile = renderProfile(loaded.node, {messages: history});
console.log("文件 Profile 的系统段：");
for (const paragraph of fromFile.systemPrompt) console.log(`  - ${JSON.stringify(paragraph)}`);
console.log("文件 Profile 的消息：", fromFile.messages.map((message) => `${message.role}:${message.text}`));

// 2. 用函数调用构造：宿主可以按参数拼出不同的树，If 只在 when 严格为 true 时保留子树。
function buildProfile(options: {readonly reviewMode: boolean}) {
    return ProfilePrompt({
        children: [
            System({children: ["你是一名写作助手。"]}),
            If({when: options.reviewMode, children: [System({children: ["当前处于审阅模式：只提意见，不直接改写。"]})]}),
            ToolResult({callId: "call-1"}),
            Message({children: ["请继续。"]}),
        ],
    });
}

for (const reviewMode of [false, true]) {
    const rendered = renderProfile(buildProfile({reviewMode}), {messages: history});
    console.log(`reviewMode=${reviewMode}：系统段 ${rendered.systemPrompt.length} 段，消息 ${rendered.messages.length} 条`);
}
