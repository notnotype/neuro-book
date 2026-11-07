# t05 实施计划：Profile 设置页

开发者 2026-11-07 确认第一稿（文末“确认结果”）。下一步做界面静态稿，版式定了再做设计审查与实施。

## Context

Profile 的后端早已做完（`agent/contributions.md`、t10、t18），但用户没有地方看和改：工具绑定 `toolBindings`、Profile 设置 `profileSettings` 只有配置项，不可用的 Profile 被选择器过滤掉、看不到原因，`modelNeeds` 只有类型没人读，用户级 Profile 只能到状态根里手工建文件。开发者 2026-11-07 定：t05 改成实施 Task，排在 t14 之前。

依据：本 Task 的三轮决定；t04 决定 4（绑定存用户配置，必需工具删不掉）；[`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md) 输出 4、7、8、13。

## 技术选型

无通用问题。下拉用 nb-ui 的 `SearchSelect`，开关用 nb-ui 现有控件。

## 关键设计

### 设置页（`plugins/agent/web/`）

新增 `profile-page.ts`（包装，同 `permission-page.ts`）与 `components/ProfileSettingsPage.vue`。page 分区 `nbook.agent.profiles`，分类 `ai`，`order: 25`（模型角色之后、运行可靠性之前），`layout: "fill"`，`layers: ["user"]`。`toolBindings`、`profileSettings` 写 `section` 指向它，不再落进“插件设置”。

左栏是 Profile 列表，右边是选中的 Profile，版式同“服务商与模型”：

- **列表**：图标、名称、来源，有问题的标“不可用”或“有错误”。可选的在前，`hidden` 的（会话标题）放最后一组“后台”：它们也要绑模型。
- **头部**：名称、说明、来源、key；不可用或有错误时写原因。
- **模型**：`SearchSelect`，选项是“跟随默认”、角色、模型，用 Composer 已经在用的模型快照（`plugin.ts` 的 `roleOptions`、`modelOptions`）。“跟随默认”时写明缺省是哪个角色（声明的 `role`）。写 `model` 与 `role` 只留一个。
- **审批模式**：跟随默认加四档，`auto`、`yolo` 带和 Composer 一致的说明与颜色。写明只影响新会话的初值。
- **工具**：按 `group` 分组列出全部已知工具，一个开关一行，写工具 id、说明、等级（读、写、执行）。必需的开着且停用；Profile 没写、`defaultForAll` 也没带上的默认关。改一项算出新的 `{added, removed}` 写回：开回 Profile 本来就有的工具时从 `removed` 删掉，不写进 `added`。两个数组都空时删掉这个 key。写明从下一次模型请求起生效。绑定里有、现在不存在的工具列在最后，标“已卸载”，能移除。有改动时显示“恢复默认”。

写入：把 `permission-writes.ts` 的排队与 `expect` 抽成通用的 `createSettingWriter(settings, setting)`，规则写入建在它上面。工具绑定和 Profile 设置是一整份 Record，连点两下、改两个 Profile 都走同一个队；冲突时按新值重算这一个 Profile 的改动再写一次（改的是单个 key，不会盖掉别处）。写失败走 `context.reportWriteFailure`。没有未保存状态。

要守住的：服务端读的仍是这两个设置项，算工具集的 `AgentTools.forProfile` 不变。页面算“开着哪些”用抽到 `shared/` 的同一个纯函数，保证页面和服务端一致。

### 目录与远程（`plugins/agent/backend/`、`shared/`）

- `ProfileEntry` 加 `tools`、`defaultTools?`、`role?`、`modelNeeds?`。插件 Profile 来自声明，用户级来自装载好的 Profile。
- `agent.profiles` 的声明加 `modelNeeds?`：页面不能为了读它激活提供方。
- 远程新增只读方法 `toolCatalog`，交回 `{id, description, group?, effect, defaultForAll?, plugin}`。
- 远程新增事件 `profilesChanged`，只说“目录变了”，页面收到后重取：用户级 Profile 是异步打包的，新建后要等它出现。

### 用户级 Profile

页面列表底部“新建 Profile”：问名字（校验成文件名），经浏览器文件客户端 `filesKey` 在 `user://profiles/<名>.profile.tsx` 排他新建一份骨架，用 `nbook.editor.open` 打开。设置窗口是非模态的，不用关。已有同名的报错、不覆盖。用户级 Profile 的详情里有“打开文件”“删除”，删除先确认，确认文字写明用它的会话会变成只读。

骨架只依赖 SDK 的 `@notnotype/nb-plugin-sdk/agent`，含名称、说明、工具要求和一段系统提示；测试里真实打包，断言状态 `ok`。不做“复制内置 Profile”：内置的主创依赖插件内部模块（`modesExtensions` 等），复制出去打包不过，这改判第一轮决定“从模板新建即复制”。

### 模型能力提示（`shared/`、`web/`）

纯函数 `modelNeedGaps(needs, model)`：交回缺看图、思考，或窗口小于 `minContext` 的哪几项。两处提示，都不拦：

- 设置页模型一行下面写“这个模型不支持看图”；
- 对话里解析到的模型不满足时，输入框上方一行同样的说明，放在现有“模型不可用”的位置，不改发送。

### 给 t14、t15 留的

白名单字段不在这里加，没有使用方的字段就是今天 `modelNeeds` 的样子。这里只定形状：Profile 声明缺省，用户在 `profileSettings` 里按 Profile 增删，页面加一节。写进 t14、t15 的 README（补上 t15 决定 3 的缺口）。`settingsSchema` 表单继续不做，同第一轮决定。

## Spec 与文档改动

- 新建 `docs/specs/agent/profile-settings.md`（planned）：页面的行为、写入、失败；`docs/specs/README.md` 登记。
- `agent/contributions.md`：删“没有界面”那条，声明加 `modelNeeds`，目录加字段（条目级 planned）；远程方法写进 `agent/sessions.md`。
- `agent/conversation.md`：加模型能力提示一条。
- `settings/` 不用改：page 分区规则已有。
- t14、t15 的 README 加白名单形状；本 Task README 改范围。

## 切片

0. 静态稿：草稿 worktree 的 Lab 里出页面，评审板定版式。不进产品代码。
1. 目录字段、`toolCatalog`、`profilesChanged`、声明 `modelNeeds`；Spec。验证：`profiles.test.ts`、`agent.test.ts`。
2. `createSettingWriter` 与工具集纯函数抽取，规则写入改用它，行为不变。验证：`permission-rules.test.ts`、`permission-page.dom.test.ts`。
3. 页面：列表、头部、模型、审批；Lab 场景。验证：新增 `profile-page.dom.test.ts`，真实配置实例。
4. 页面：工具一节。验证：同上，加“页面算的和 `forProfile` 一致”。
5. 用户级 Profile 新建、打开、删除。验证：真实打包的 `profiles.test.ts`，e2e。
6. 模型能力提示。验证：`session-host.test.ts`、dom 测试。

## 验收映射

Spec 编号写定后补。至少：改工具绑定后下一次请求工具集变（`agent/contributions.md` 验收 3，经页面写入）；必需工具关不掉；Profile 设置的模型与审批模式对新会话生效（输出 13）；连点两下不丢（同规则页）；不可用的 Profile 看得到原因；新建的骨架打包成功并出现在列表和新建会话的选择器里。

## 验证

- 自动：`test:affected`；e2e 只跑 `settings`、`agent-conversation`、`lab-agent-ui`；`docs:check`、`governance:check`。
- 真实浏览器：开发服务里走一遍新建 Profile、给它关一个工具、绑模型、新建会话用它发一条（本机假端点或开发者同意的真实模型），亮色截图看版式。
- 未验证边界：`modelNeeds` 现在没有内置 Profile 声明，产品里只有用户写了才看得到，靠测试 Profile 验证。

## 不做与风险

- 不做：`settingsSchema` 表单；按 Profile 的压缩设置；按 Profile 的 Skill、子代理白名单；插件 Profile 的启用与停用。
- 风险：`toolCatalog` 的说明是给模型看的，可能很长且不是当前语言，页面只显示第一行、全文在悬停。

## 确认结果（开发者 2026-11-07，都按推荐）

1. 版式与注意力顺序：列表加“名称、说明 → 问题 → 模型 → 审批模式 → 工具”，工具默认全部展开。
2. 用户级 Profile 的新建、打开、删除纳入本 Task；新建用骨架文件，不做复制内置（改第一轮决定）。
3. `modelNeeds` 做两处提示、不拦发送。
4. 白名单字段随 t14、t15 加，这里只定形状。
