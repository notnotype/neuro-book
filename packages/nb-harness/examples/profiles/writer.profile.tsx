/** @jsxImportSource @notnotype/nb-harness/profile */
/**
 * 示例 Profile：一个会读改小说文件的写作助手。
 *
 * Profile 文件可以放在任何目录（用户的作品目录、插件目录），由 `loadProfile(path)` 加载：它对
 * `@notnotype/nb-harness/profile` 的导入与上面的 `@jsxImportSource` 由加载器解析到本包，文件旁边不需要 node_modules。
 * 这个文件在包内，同样走这条路（场景与命令行都用 `loadProfile`）。
 *
 * 三个分区各管一段：
 * - `<System>`：系统提示词，每次请求重新渲染。
 * - `<History>`：会话历史；子节点是**种子**，新会话开始时写进会话一次，每次压缩之后再写一次（`once` 的除外）。
 *   种子属于历史，所以能享受提示词缓存；`<WorkspaceTree />` 的数据在每次调用开始时重新取，压缩后重写的种子就是新的目录。
 * - `<Appending>`：即将进入历史的消息，调用开始时写入：`<Input />` 是用户这次的输入，`<Reminder>` 按条件插入提醒。
 *
 * `tools` 列出要用的工具（可见工具 = 这里列出的 ∩ 来源此刻可用的；列了没装的，预览会给 `unknown-tool` 警告），
 * `compaction` 给出压缩设置；没写 `model`，所以模型按配置的 `models.defaultModel`。这四个一等属性并进 `fields` 的 `harness/*` 字段，
 * `fields` 本身留给第三方命名空间（插件登记的字段）。
 *
 * 行为合同：docs/specs/harness/profile.md（节点与父子关系、输出第 7–11 条）；字段的含义见 tools、models、compaction 三份 Spec。
 */

import {Appending, defineProfile, Developer, History, Input, Prompt, Reminder, System, Tag, User} from "@notnotype/nb-harness/profile";
import {WorkspaceTree} from "../nodes/workspace-tree";

export default defineProfile({
    id: "writer",
    name: "写作助手",
    description: "读取并修改工作区里的小说章节",
    version: 1,
    tools: ["read", "edit"],
    compaction: {keepRecentTokens: 4000, threshold: {percent: 80}},
    prompt: (ctx) => (
        <Prompt>
            <System>
                你是小说写作助手。修改文件前必须先用 read 读到它，再用 edit 按 read 给出的 [地址#tag] 头修改；文件用资源地址找：作品在 project://，草稿写到 local://，参考文档在 docs://（只读）；
                只改用户要求的句子，保持第三人称。
            </System>
            <History>
                <Developer once>会话 {ctx.session.id} 于 {ctx.now.toISOString()} 开始；工作区根目录就是作品目录。</Developer>
                <User>
                    <Tag name="workspace"><WorkspaceTree /></Tag>
                </User>
            </History>
            <Appending>
                <Input />
                <Reminder id="style" every={3}>保持第三人称；不要改动没有 read 过的行。</Reminder>
            </Appending>
        </Prompt>
    ),
});
