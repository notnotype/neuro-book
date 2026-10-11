/** @jsxImportSource @notnotype/nb-harness/profile */
/**
 * 第 2 步用的 Profile 文件：放在任何目录都能由 `loadProfile` 加载（文件旁不需要 node_modules）。
 *
 * - `<History>` 的子节点是种子：新会话第一次调用时写进会话，之后就是历史的一部分（能吃到提示词缓存）；`once` 的压缩后不再写。
 * - `<Appending>` 在每次调用开始时写进会话：`<Input />` 是这次的输入，`<Reminder>` 按轮插入提醒（这里每 2 轮一次）。
 * - `ctx` 是运行时给的只读上下文：会话 id、标题（可选）、第几轮、此刻时间、字段值。提示词函数不做 I/O。
 *
 * 行为合同：docs/specs/harness/profile.md 输入“定义 Profile”、输出 7–11。
 */

import {Appending, defineProfile, Developer, History, Input, Prompt, Reminder, System} from "@notnotype/nb-harness/profile";

export default defineProfile({
    id: "assistant", name: "写作助手", description: "第 2 步：从文件加载的 Profile", version: 1,
    prompt: (ctx) => (
        <Prompt>
            <System>你是写作助手，回答简洁，用中文。</System>
            <History>
                <Developer once>会话 {ctx.session.id} 开始于 {ctx.now.toISOString()}。</Developer>
            </History>
            <Appending>
                <Input />
                <Reminder id="brief" every={2}>回答控制在三句以内。</Reminder>
            </Appending>
        </Prompt>
    ),
});
