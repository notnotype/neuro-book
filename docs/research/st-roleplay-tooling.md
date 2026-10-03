# SillyTavern RP Tooling Research

本文整理本地参考仓库中与 RP 角色卡迁移相关的机制。资料来源全部来自 `.agent/workspace/` 下的本地仓库，不依赖在线文档。

参考仓库：

- `.agent/workspace/JS-Slash-Runner`
- `.agent/workspace/JS-Slash-Runner-Doc`
- `.agent/workspace/MagVarUpdate`
- `.agent/workspace/ST-Prompt-Template`

## 阅读范围和引用方式

本文件是后续 Agent 的本地索引，不引用在线网页。需要继续深挖时，优先按以下入口阅读：

- JS-Slash-Runner 安全和定位：`.agent/workspace/JS-Slash-Runner/README.md`
- JS-Slash-Runner API 类型：`.agent/workspace/JS-Slash-Runner/@types/function/*.d.ts` 和 `.agent/workspace/JS-Slash-Runner/@types/iframe/*.d.ts`
- JS-Slash-Runner 实现：`.agent/workspace/JS-Slash-Runner/src/function/*.ts`
- JS-Slash-Runner 中文文档：`.agent/workspace/JS-Slash-Runner-Doc/src/guide/功能详情/**`
- MagVarUpdate 数据模型：`.agent/workspace/MagVarUpdate/src/variable_def.ts`
- MagVarUpdate 初始化：`.agent/workspace/MagVarUpdate/src/function/initvar/variable_init.ts`
- MagVarUpdate 更新解析：`.agent/workspace/MagVarUpdate/src/function/update_variables.ts`
- MagVarUpdate 额外模型：`.agent/workspace/MagVarUpdate/src/function/update/on_message_received.ts` 和 `.agent/workspace/MagVarUpdate/src/function/update/invoke_extra_model.ts`
- MagVarUpdate 测试：`.agent/workspace/MagVarUpdate/tests/*`
- ST-Prompt-Template 功能文档：`.agent/workspace/ST-Prompt-Template/docs/features_cn.md`
- ST-Prompt-Template 内置函数文档：`.agent/workspace/ST-Prompt-Template/docs/reference_cn.md`
- ST-Prompt-Template 生成处理入口：`.agent/workspace/ST-Prompt-Template/src/modules/handler.ts`
- ST-Prompt-Template EJS 上下文：`.agent/workspace/ST-Prompt-Template/src/function/ejs.ts`
- ST-Prompt-Template 世界书装饰器：`.agent/workspace/ST-Prompt-Template/src/function/worldinfo.ts`
- ST-Prompt-Template 消息注入：`.agent/workspace/ST-Prompt-Template/src/features/inject-prompt.ts`
- ST-Prompt-Template 初始变量：`.agent/workspace/ST-Prompt-Template/src/features/initial-variables.ts`

引用本文件时，建议同时给出源码路径，避免只凭概念迁移。四个项目的关键点不是“有变量”，而是：

- 在浏览器侧执行 JavaScript。
- 读写 SillyTavern 聊天楼层、swipe、世界书、正则、预设、角色卡和扩展设置。
- 在生成前、生成后、消息渲染后多个阶段修改 prompt 或显示内容。
- 把变量写入 `chat`、`message`、`character`、`script`、`extension` 等不同作用域。
- 通过 MVU 把模型输出的受限更新命令落成状态变化。

## 总览

当前三张 SillyTavern 样本卡都或多或少使用了以下机制：

- JS-Slash-Runner / Tavern-Helper：在 SillyTavern 中运行 JavaScript，提供变量、消息、角色卡、世界书、正则、预设、提示词注入和脚本按钮等 API。
- MagVarUpdate：基于 Tavern-Helper 的 MVU 状态维护脚本，把 LLM 输出中的更新命令解析成变量变更，维护 `stat_data`、`display_data`、`delta_data` 和 `schema`。
- ST-Prompt-Template：在生成前、楼层渲染时和世界书处理中执行 EJS 模板，支持 `getvar` / `setvar`、`@INJECT`、`[GENERATE:*]`、`[RENDER:*]`、`@@if`、`injectPrompt` 等动态提示词能力。

对 Neuro Book 的启发是：不要把这些插件逐字复刻为前端脚本运行环境。第一阶段应把它们理解为“卡片作者想表达的状态系统、动态提示词规则、世界书激活策略和 UI 状态栏”，再迁移成当前项目更自然的 `roleplay/`、`lorebook/`、`reference/`、`state.md` 和后续自然语言编辑工具。

## JS-Slash-Runner / Tavern-Helper

### 定位

JS-Slash-Runner 是一个 SillyTavern 第三方扩展，用 iframe 隔离执行外部 JavaScript，并向脚本提供 `TavernHelper` API。它的 README 明确提醒执行自定义 JS 有安全风险，脚本可能读取 API key、聊天记录、修改设置或发送请求。

本地入口：

- `.agent/workspace/JS-Slash-Runner/README.md`
- `.agent/workspace/JS-Slash-Runner-Doc/src/guide/基本用法/如何正确使用酒馆助手.md`

关键安全结论：

- 自定义脚本有权限读取聊天记录、变量、角色卡、世界书、预设和部分扩展设置。
- 脚本可以发起请求、修改设置、修改消息、创建/删除数据。
- iframe 是前端隔离和运行容器，不等于可放心执行第三方逻辑。
- Neuro Book 导入 ST 卡时只能分析脚本，不应自动运行脚本。

### 变量系统

Tavern-Helper 扩展了 SillyTavern 原本较少的变量类型。文档和类型定义列出的变量作用域包括：

- `global`：用户存档级全局变量。
- `preset`：绑定到当前预设，可随预设导出。
- `character`：绑定到当前角色卡，可随角色卡导出。
- `chat`：绑定到当前聊天文件。
- `message`：绑定到某个聊天楼层，支持 `message_id`，负数表示深度索引。
- `script`：绑定到某个脚本，脚本内可省略 `script_id`。
- `extension`：绑定到指定扩展 ID。

核心 API：

- `getVariables(option)`
- `replaceVariables(variables, option)`
- `updateVariablesWith(updater, option)`
- `insertOrAssignVariables(variables, option)`
- `insertVariables(variables, option)`
- `deleteVariable(variable_path, option)`
- `registerVariableSchema(schema, option)`

源码引用：

- `.agent/workspace/JS-Slash-Runner/src/function/variables.ts`
- `.agent/workspace/JS-Slash-Runner/@types/function/variables.d.ts`
- `.agent/workspace/JS-Slash-Runner/@types/iframe/variables.d.ts`
- `.agent/workspace/JS-Slash-Runner/src/store/variable_schemas.ts`
- 文档：`.agent/workspace/JS-Slash-Runner-Doc/src/guide/功能详情/变量/变量类型.md`
- 文档：`.agent/workspace/JS-Slash-Runner-Doc/src/guide/功能详情/变量/获取变量.md`
- 文档：`.agent/workspace/JS-Slash-Runner-Doc/src/guide/功能详情/变量/替换或修改变量.md`
- 文档：`.agent/workspace/JS-Slash-Runner-Doc/src/guide/功能详情/变量/注册变量结构.md`

源码细节：

- `src/function/variables.ts` 中 `getVariables()` 默认读取 `{type: 'chat'}`。
- `message` 变量的 `message_id` 支持负数深度索引；未传或 `latest` 时读取最新非 system 消息，但写入时会归一到最后一楼。
- `script` 变量必须有 `script_id`，脚本内调用会隐式使用当前脚本 ID。
- `extension` 变量读写 `extension_settings[extension_id]`。
- `updateVariablesWith()` 是读出整个变量表、交给 updater 修改、再整表写回；这说明并发写入和冲突覆盖在 ST 里没有强事务保障。
- `registerVariableSchema()` 主要注册到变量管理器 schema store，用于 UI/编辑辅助。

迁移提示：

- `message` 变量接近 Neuro Book 未来“某一轮 RP 后的状态快照”。
- `chat` 变量接近当前 RP session 的全局状态。
- `character` / `script` 变量说明 ST 卡常把状态绑定在角色卡或脚本上；迁移时不要默认认为所有状态都属于单个角色。
- `registerVariableSchema` 只服务变量管理器 UI，不改变运行时校验；Neuro Book 后续如果做变量系统，需要把 schema 校验放在真实写入路径上。

### 脚本树和按钮

Tavern-Helper 可以读写脚本树和脚本按钮。文档里有：

- `replaceScriptTrees(script_trees, {type})`
- `updateScriptTreesWith(updater, {type})`
- `replaceScriptButtons(buttons)`
- `updateScriptButtonsWith(updater)`
- `appendInexistentScriptButtons(buttons)`
- `replaceScriptInfo(info)`

脚本树支持 `global`、`preset`、`character` 三类来源。角色卡可以带局部脚本、脚本按钮和脚本数据。

源码/文档引用：

- `.agent/workspace/JS-Slash-Runner-Doc/src/guide/功能详情/酒馆助手脚本/创建和修改脚本.md`
- `.agent/workspace/JS-Slash-Runner/@types/function/script.d.ts`

迁移提示：

- ST 卡里的 `extensions.tavern_helper.scripts` 与 `regex_scripts` 不能直接当作本项目可执行逻辑。
- 第一阶段转换应把脚本作为 `reference/silly-tavern/{card}/raw/` 和 `inspect.md` 中的“动态逻辑说明”保留。
- 如果脚本只是状态栏或按钮交互，迁移时可转成 `roleplay/README.md` 或后续 UI TODO；如果脚本含 API 请求、外部存储或记忆系统，必须单独审查。

### 事件和消息生命周期

Tavern-Helper 暴露 `eventOn`、`eventOnce`、`eventEmit`、`eventEmitAndWait`，可监听 SillyTavern 原生事件和自定义事件。常见事件包括：

- `MESSAGE_SENT`
- `MESSAGE_RECEIVED`
- `MESSAGE_UPDATED`
- `USER_MESSAGE_RENDERED`
- `CHARACTER_MESSAGE_RENDERED`
- `GENERATION_AFTER_COMMANDS`
- `GENERATION_STARTED`
- `GENERATION_ENDED`
- iframe 自定义的 `STREAM_TOKEN_RECEIVED*`、`GENERATION_*`

源码/文档引用：

- `.agent/workspace/JS-Slash-Runner/src/function/event.ts`
- `.agent/workspace/JS-Slash-Runner/@types/iframe/event.d.ts`
- `.agent/workspace/JS-Slash-Runner-Doc/src/guide/功能详情/监听和发送事件.md`

迁移提示：

- ST 卡中的脚本常靠事件驱动更新变量、追加状态栏占位符、刷新消息或触发额外模型。转换时必须记录它监听了哪些事件。
- Neuro Book 第一阶段不需要复刻事件总线。需要迁移的是“什么时候更新状态”的语义，例如“模型回复后解析变量更新”。
- 如果未来做 RP runtime，应把生命周期限定为后端受控阶段，例如 `beforePromptBuild`、`afterModelReply`、`beforeStateWrite`、`afterStateWrite`，而不是开放任意 JS 事件。

### 提示词注入

Tavern-Helper 也提供直接注入提示词的 API：

```ts
injectPrompts(prompts: InjectionPrompt[], options?: {once?: boolean})
uninjectPrompts(ids: string[])
```

`InjectionPrompt` 包含：

- `id`
- `position: 'in_chat' | 'none'`
- `depth`
- `role: 'system' | 'assistant' | 'user'`
- `content`
- `filter`
- `should_scan`

引用：

- `.agent/workspace/JS-Slash-Runner/src/function/inject.ts`
- `.agent/workspace/JS-Slash-Runner/@types/function/inject.d.ts`
- `.agent/workspace/JS-Slash-Runner-Doc/src/guide/功能详情/注入提示词.md`

迁移提示：

- ST 的提示词注入类似“运行时临时上下文补丁”。Neuro Book 不应把它原样迁到永久 system prompt。
- 对 RP skill 来说，应该把稳定规则写入 `roleplay/GM.md` 或 lorebook/rule；临时 session 规则写入 `roleplay/sessions/current.md`。

## MagVarUpdate

### 定位

MagVarUpdate 是基于 Tavern-Helper 的变量状态维护脚本，目标是降低状态栏和变量更新对主模型注意力的消耗。它不再依赖每轮正则扫描所有历史楼层，而是在消息生成后解析变量更新块，把状态写到消息变量中。

入口：

- `.agent/workspace/MagVarUpdate/README.md`
- `.agent/workspace/MagVarUpdate/doc/tutorial.md`

### 基本工作流

典型安装包含：

1. 在角色卡中增加局部脚本，导入 MVU bundle。
2. 增加正则隐藏 `<UpdateVariable>...</UpdateVariable>`。
3. 增加正则隐藏 `<StatusPlaceHolderImpl/>` 或状态栏占位。
4. 在世界书中放 `[InitVar]` 条目作为初始变量。
5. 在提示词中要求 LLM 生成 `<UpdateVariable>` 块。
6. MVU 在 `MESSAGE_RECEIVED` 或 `MESSAGE_SENT` 后解析更新命令，并写回消息变量。

源码引用：

- `.agent/workspace/MagVarUpdate/src/function/update/index.ts`
- `.agent/workspace/MagVarUpdate/src/function/update/on_message_received.ts`
- `.agent/workspace/MagVarUpdate/src/function/update_variables.ts`
- `.agent/workspace/MagVarUpdate/src/function/initvar/variable_init.ts`

### 数据模型

MVU 的核心数据对象是 `MvuData`：

- `initialized_lorebooks: Record<string, any[]>`
- `stat_data`：实际状态数据。
- `schema`：根据状态数据生成的结构约束。
- `display_data`：显示用变更记录，例如 `旧值->新值 (原因)`。
- `delta_data`：本轮变更记录。

`stat_data` 支持嵌套对象、数组和 ValueWithDescription：

```ts
type ValueWithDescription<T> = [T, string]
```

即很多变量写成：

```json
{
  "好感度": [15, "[-100,100]之间，随互动更新"]
}
```

引用：

- `.agent/workspace/MagVarUpdate/src/variable_def.ts`
- `.agent/workspace/MagVarUpdate/src/function/schema.ts`
- `.agent/workspace/MagVarUpdate/tests/schema.test.ts`
- `.agent/workspace/MagVarUpdate/tests/template.test.ts`

迁移提示：

- `stat_data` 可以作为 Neuro Book 后续 RP 变量系统的参考，但当前第一阶段不应直接实现完整 MVU。
- `display_data` / `delta_data` 对 RP 很有价值：它能解释“为什么状态变了”，比裸数值更适合作为 chat bubble 或 session log。
- ValueWithDescription 很适合让模型理解变量更新条件，但对手写 Markdown 不友好；后续可考虑 YAML frontmatter 或 `state.json`。

### Schema、模板和元数据

MVU 不只是把 JSON 存起来。`src/variable_def.ts` 和 `src/function/schema.ts` 还定义了 schema 和模板能力：

- `StatData` 支持普通 JSON、嵌套对象、数组、`$meta` 和 `$arrayMeta`。
- `ObjectSchemaNode` / `ArraySchemaNode` / `PrimitiveSchemaNode` 描述变量结构。
- `StatDataMeta` 支持 `extensible`、`recursiveExtensible`、`required`、`template`。
- 根级 `$meta` 可带 `strictTemplate`、`concatTemplateArray`、`strictSet`。
- `template` 用于给新增对象或数组元素补默认结构。

`src/function/update_variables.ts` 的 `applyTemplate()` 表示模板应用规则：

- 对象值遇到对象模板时合并，值优先。
- 数组值遇到数组模板时可拼接或按索引合并。
- 原始值遇到数组模板时，在非 strict 模式下可转为数组并合并。
- 类型不匹配时跳过模板。

迁移提示：

- 轻量迁移时不要丢失 `$meta`、`template`、`required` 这类约束。它们往往是卡作者防止变量乱长的关键。
- Neuro Book 后续变量系统可以把这些信息拆成 `schema.json`、`current.json`、`descriptions.json` 和 `update-rules.md`，而不是把 MVU 格式原封不动塞进 Markdown。

### InitVar

MVU 在新聊天加载或每条消息发送前检查变量是否初始化。它从启用世界书中读取名字包含 `[InitVar]` 的条目，解析 YAML/JSON，合并到 `stat_data`。

开场白也可以包含 `<initvar>...</initvar>` 覆盖初始变量。源码里 `loadInitVarData()` 会读取世界书条目，`initCheck()` 会处理第一条消息 swipes 的 `<initvar>`。

引用：

- `.agent/workspace/MagVarUpdate/src/function/initvar/variable_init.ts`
- `.agent/workspace/MagVarUpdate/tests/variable_init.test.ts`

源码细节：

- `initCheck()` 会从最后有效变量或空 `MvuData` 开始，确保 `initialized_lorebooks`、`stat_data`、`schema` 存在。
- `loadInitVarData()` 会遍历启用世界书和当前角色世界书，只处理 `comment` 包含 `[initvar]` 的条目。
- initvar 内容可被 `<initvar>...</initvar>` 或代码块包裹，解析时会剥掉包裹。
- 世界书 initvar 通过 `correctlyMerge()` 合并，再以 `{...merged_data, ...existing_stat_data}` 写回，所以已有 `stat_data` 优先于新加载 initvar。
- 如果开场白 swipe 内含 `<initvar>`，它会覆盖角色世界书 initvar 的基准状态，并重新加载其他世界书 initvar。
- 初始化后会生成 schema，并清理 `$meta` 等运行时元数据。

迁移提示：

- ST 卡转换时应识别 `[InitVar]` / `<initvar>` / 初始变量世界书条目。
- 在 Neuro Book 中可先把它们归档到 `roleplay/imports/silly-tavern/{card}/initvar.md` 或转成 `roleplay/sessions/current.md` 的“初始状态草案”。

### 更新命令格式

MVU 从消息中解析类代码命令和 JSON Patch。常见命令：

- `_.set(path, oldValue, newValue);//reason`
- `_.set(path, newValue);//reason`
- `_.assign(...)`
- `_.insert(...)`
- `_.remove(...)`
- `_.unset(...)`
- `_.delete(...)`
- `_.add(path, delta);//reason`
- JSON Patch block：`<json_patch>...</json_patch>` 或 `<jsonpatch>...</jsonpatch>`

源码中 `extractCommands()` 使用状态机解析命令，避免简单正则被嵌套括号、字符串里的 `);` 搞坏。`parseCommandValue()` 会尝试解析 JSON、对象/数组字面量、布尔值、null、undefined、数学表达式、YAML，最后回退为字符串。

引用：

- `.agent/workspace/MagVarUpdate/src/function/update_variables.ts`
- `.agent/workspace/MagVarUpdate/tests/extractSetCommands.test.ts`
- `.agent/workspace/MagVarUpdate/tests/json_patch.test.ts`

源码细节：

- `extractCommands()` 先提取 `<json_patch>` / `<jsonpatch>` 块，再扫描 `_.set`、`_.insert`、`_.assign`、`_.remove`、`_.unset`、`_.delete`、`_.add`。
- 命令扫描使用括号配对状态机，不靠单一正则，避免字符串或嵌套结构中的 `);` 截断命令。
- JSON Patch 会被转换为内部命令：`replace` -> `set`，`delta` -> `add`，`add/insert` -> `insert`，`remove` -> `delete`，`move` -> `move`。
- `parseCommandValue()` 会依次尝试布尔/null/undefined、JSON、JS 对象/数组字面量、mathjs 数学表达式、YAML，最后回退为去引号字符串。
- 命令注释 `// reason` 会进入 display/delta 记录，用于说明状态变化原因。

迁移提示：

- 这是后续泛用自然语言编辑工具和 RP 变量系统的重要参考：让模型输出受限命令或 JSON Patch，比让模型直接改全文更容易校验。
- 第一阶段纯文字卡导入只需要识别这些块并解释其意图，不执行。
- 后续 Neuro Book 若实现变量写入工具，应优先支持 JSON Patch，不必兼容所有 `_.set` 风格命令；`_.set` 可作为导入时识别和转换对象。

### 事件

MVU 暴露事件用于修正命令、限制更新、回调副作用：

- `mag_variable_initialized`
- `mag_variable_update_started`
- `mag_command_parsed`
- `mag_variable_update_ended`
- `mag_before_message_update`
- `mag_variable_updated`：已标记 deprecated。

引用：

- `.agent/workspace/MagVarUpdate/src/variable_def.ts`
- `.agent/workspace/MagVarUpdate/tests/export_globals.integration.test.ts`

迁移提示：

- 后续 Neuro Book 若做变量系统，可考虑类似生命周期：解析前、命令解析后、写入前、写入后。
- 但事件不应开放执行任意用户脚本；优先做受控 hook 或 profile/tool 配置。

### 额外模型解析

MVU 支持在主回复之后调用额外模型解析变量更新。模式包括：

- 随 AI 输出：直接从主回复中读取 `<UpdateVariable>`。
- 额外模型解析：只用最后两楼消息和相关世界书条目，让额外模型生成更新命令。
- 工具调用或格式化输出：如果模型支持 tools/function calling 或 OpenAI-compatible `response_format.json_schema`，可得到更稳的结构化结果。
- 请求策略支持依次重试、同时请求多次、先请求一次失败后并发。

引用：

- `.agent/workspace/MagVarUpdate/src/function/update/on_message_received.ts`
- `.agent/workspace/MagVarUpdate/src/function/update/invoke_extra_model.ts`
- `.agent/workspace/MagVarUpdate/src/panel/update/request_method.md`
- `.agent/workspace/MagVarUpdate/src/panel/update/prompt_toolcall.md`
- `.agent/workspace/MagVarUpdate/src/function/function_call.ts`

迁移提示：

- 这和当前讨论的泛用自然语言编辑工具很接近：用低配模型处理状态更新，减轻主 Agent 的负担。
- Neuro Book 的版本应是后端工具，不应把 JS 插件式脚本跑在用户浏览器里。
- 额外模型只读取最后两楼和相关世界书条目的设计值得借鉴：状态更新模型不需要完整上下文，只需要当前变量、最近行为和更新规则。
- 格式化输出和 tool/function calling 是比自由文本 `<UpdateVariable>` 更稳的方向。

## ST-Prompt-Template

### 定位

ST-Prompt-Template 用 EJS 扩展 SillyTavern 提示词处理。它在生成前处理提示词，在楼层渲染时处理输出，也能通过世界书条目和 `@INJECT` 改写消息结构。

入口：

- `.agent/workspace/ST-Prompt-Template/README_CN.md`
- `.agent/workspace/ST-Prompt-Template/docs/features_cn.md`
- `.agent/workspace/ST-Prompt-Template/docs/reference_cn.md`

### EJS 基本语法

在世界书、预设提示词、角色内容和消息中使用：

- `<% ... %>` 执行 JS。
- `<%- ... %>` 输出未转义内容。
- `<%= ... %>` 输出转义/格式化内容。

处理阶段：

1. SillyTavern 构建提示词。
2. 扩展执行 EJS，替换模板结果。
3. 发送给 LLM。
4. LLM 输出后，扩展在楼层渲染阶段再次处理可见 EJS。

引用：

- `.agent/workspace/ST-Prompt-Template/docs/features_cn.md`
- `.agent/workspace/ST-Prompt-Template/src/function/ejs.ts`
- `.agent/workspace/ST-Prompt-Template/src/modules/handler.ts`

迁移提示：

- ST 卡里的世界书内容可能不是静态文本，里面的 `<% ... %>` 可能决定条目是否生效、输出哪段规则、读取哪些变量。
- 转换 skill 必须标记 EJS 片段，不要当普通设定导入。

### 生成和渲染生命周期

`src/modules/handler.ts` 是理解 ST-Prompt-Template 的关键入口：

- `handleGenerateBefore()`：生成前处理 `[GENERATE:BEFORE]` 和 `@@generate_before`。
- `handleWorldInfoLoaded()`：世界书加载后处理装饰器，可能删除特殊条目、按 `@@if` 过滤、预处理条目内容、强制启用/禁用条目。
- `processGenerateAfter()`：对将发送给模型的 messages 做 EJS 和注入处理。
- `handleChatCompletionReady()`：OpenAI chat completion 消息准备好后处理 messages。
- 生成处理会调用 `setForceOutlet()`，延迟注入输出，保证收集到完整内容。
- 渲染处理会对 `[RENDER:*]`、`@@render_*`、`@@iframe`、`@@message_formatting` 做可见层处理。

迁移提示：

- `[GENERATE:*]` 属于发给模型的上下文控制；`[RENDER:*]` 属于 UI/状态栏控制；`handleWorldInfoLoaded()` 里的过滤和预处理属于“世界书激活逻辑”。
- 导入到 Neuro Book 时要保留这三类语义，不要把它们都写进 lorebook 正文。
- 第一阶段可以把这类条目归档到 `roleplay/imports/silly-tavern/{card}/dynamic-prompt.md`，由转换报告解释意图。

### 变量函数

参考文档列出：

- `setvar`
- `getvar`
- `incvar`
- `decvar`
- `execute`
- `getwi`
- `getchar`
- `getpreset`
- `define`
- `getqr`
- `getCharData`
- `getWorldInfoData`
- `evalTemplate`
- `activewi`
- `activateRegex`
- `injectPrompt`
- `getPromptsInjected`
- `jsonPatch`
- `patchVariables`

引用：

- `.agent/workspace/ST-Prompt-Template/docs/reference_cn.md`
- `.agent/workspace/ST-Prompt-Template/src/function/ejs.ts`
- `.agent/workspace/ST-Prompt-Template/src/function/variables.ts`
- `.agent/workspace/ST-Prompt-Template/src/function/json-patch.ts`

源码细节：

- `prepareContext()` 会把大量函数和运行时对象注入 EJS 上下文，包括 `_`、`$`、`z`、`toastr`、`SillyTavern`、`faker`、`variables`、`getvar/setvar/incvar/decvar`、`getwi`、`getchar`、`getpreset`、`activateRegex`、`injectPrompt`、`jsonPatch`。
- 变量作用域和 JS-Slash-Runner 不完全同名：`setvar/getvar` 支持 `global`、`local`、`message`、`cache`、`initial`。
- `withMsg` 可按消息角色、楼层 ID、swipe 选择消息变量。
- `dryRun` 控制准备阶段是否允许写变量。
- `setVariableSchema` 可从模板层注册变量结构。

迁移提示：

- `getwi` / `activewi` 对应“动态召回世界书条目”，在 Neuro Book 中更接近 retrieval 或显式 read_file。
- `getchar` / `getCharData` 对应读取角色卡数据；转换后应变成读取 `lorebook/character/...` 或 `roleplay/cast/...`。
- `injectPrompt` / `getPromptsInjected` 表示提示词片段的依赖倒置，可参考为 `roleplay/GM.md` 中的命名片段，但第一阶段不需要实现动态注入。
- `setvar/incvar/decvar/jsonPatch/patchVariables` 表示模板可以产生副作用。遇到这类 EJS 时，应标记为“运行时变量逻辑”，不要作为纯文本设定导入。

### 内容注入

ST-Prompt-Template 支持世界书标题前缀：

- `[GENERATE:BEFORE]`
- `[GENERATE:AFTER]`
- `[RENDER:BEFORE]`
- `[RENDER:AFTER]`
- `[GENERATE:{idx}:BEFORE]`
- `[GENERATE:{idx}:AFTER]`
- `[InitialVariables]`
- `[GENERATE:REGEX:pattern]`

`[RENDER:*]` 只影响显示，不发给 LLM。`[InitialVariables]` 把条目内容作为变量树写入初始消息变量。

引用：

- `.agent/workspace/ST-Prompt-Template/docs/features_cn.md`
- `.agent/workspace/ST-Prompt-Template/src/modules/handler.ts`
- `.agent/workspace/ST-Prompt-Template/src/features/initial-variables.ts`

迁移提示：

- 转换时应把 `[GENERATE:*]` 看作“发送给模型的规则/上下文”，把 `[RENDER:*]` 看作“状态栏/UI”，把 `[InitialVariables]` 看作状态初始值。
- `[GENERATE:REGEX:*]` 是条件提示词，不是普通世界书事实；需要保留 pattern 和触发意图。
- `[InitialVariables]` 只支持标准 JSON 且必须是 object；这与 MVU 的 `[InitVar]` 支持 YAML/JSON 不同。

### @INJECT

`@INJECT` 允许把世界书条目内容作为完整消息插入 prompt，支持：

- 绝对位置：`@INJECT pos=1,role=system`
- 目标消息：`@INJECT target=user,index=1,at=before,role=system`
- 正则匹配：`@INJECT regex=你好,at=before,role=system`

文档强调 system 消息最好放在开头，不同 API 对 role 和消息交替有不同限制。

引用：

- `.agent/workspace/ST-Prompt-Template/docs/features_cn.md`
- `.agent/workspace/ST-Prompt-Template/src/features/inject-prompt.ts`

源码细节：

- `handleInjectPrompt()` 只收集标题以 `@INJECT` 开头的世界书条目。
- 条目需满足启用状态，或带 `@@always_enabled`；带 `@@only_preload` 的条目不会进入生成注入。
- 支持世界书概率触发 `useProbability` / `probability`。
- 内容会先经过宏替换、正则处理和 EJS 求值。
- 支持三类插入：绝对 `pos`、按角色目标 `target/index/at`、按消息内容正则 `regex/at`。
- 插入队列会按最终位置、世界书 `order` 和类型优先级排序。

迁移提示：

- 这类条目在 Neuro Book 中不应直接进入普通 lorebook 知识节点。它们是 prompt 结构控制，应转成 `roleplay/GM.md`、profile prompt、或等待后续 RP runtime 支持。
- inspect 报告应记录 `@INJECT` 的目标 role、位置、触发条件和概率。

### 装饰器

ST-Prompt-Template 支持 `@@` 装饰器：

- `@@activate`
- `@@dont_activate`
- `@@message_formatting`
- `@@generate_before`
- `@@generate_after`
- `@@render_before`
- `@@render_after`
- `@@dont_preload`
- `@@initial_variables`
- `@@always_enabled`
- `@@only_preload`
- `@@private`
- `@@if`
- `@@iframe`
- `@@preprocessing`

其中 `@@if` 对转换很关键：它说明某条世界书不是稳定事实，而是条件触发内容。

引用：

- `.agent/workspace/ST-Prompt-Template/docs/features_cn.md`
- `.agent/workspace/ST-Prompt-Template/src/function/worldinfo.ts`
- `.agent/workspace/ST-Prompt-Template/src/utils/evaluate.ts`

源码细节：

- `worldinfo.ts` 的 `parseDecorators()` 只识别条目内容开头连续的已知 `@@` 行。
- `WorldInfoDecorators.isSpecialEntry()` 会把 `[GENERATE:*]`、`[RENDER:*]`、`@INJECT`、`[InitialVariables]` 和对应装饰器视为特殊条目，防止它们作为普通世界书上下文进入 prompt。
- `@@if 条件` 会被转换成 EJS 表达式求值；结果为 false 时条目会从上下文移除。
- `@@private` 会把条目内容包在局部作用域里，降低 EJS 变量重复声明冲突。
- `@@iframe` 只在 render 场景有意义，通常对应状态栏或富 UI。

迁移提示：

- `@@if` 条目可转为 `retrieval.trigger`、`roleplay` 条件规则或保留在 import report 中等待人工确认。
- `@@iframe` / `@@message_formatting` 多为 UI 状态栏，不应作为稳定设定导入。

### ST-Prompt-Template 与 MVU 的交叉点

三张样本卡同时使用 MVU 和 ST-Prompt-Template 时，常见模式是：

- ST-Prompt-Template 用 `[InitialVariables]` 或 `@@initial_variables` 写入初始变量。
- MVU 用 `[InitVar]` 和 `<initvar>` 初始化 `stat_data`。
- ST-Prompt-Template 用 `@@if variables.xxx` 控制世界书条目是否启用。
- MVU 在每轮后更新 `message` 变量；ST-Prompt-Template 在下一轮 prompt 构建时读取这些变量。
- `[RENDER:*]` 或 `@@render_*` 根据变量渲染状态栏。
- `@INJECT` 根据变量和最近消息插入额外 system/user/assistant 消息。

迁移提示：

- inspect 工具需要把“变量初始化来源”“变量读取点”“变量写入点”“状态栏渲染点”“prompt 注入点”分开列出来。
- 不要只统计 worldbook entries 数量；需要分类每条 entry 是静态设定、条件设定、初始化变量、更新规则、生成注入、渲染 UI，还是脚本逻辑。

## 对 Neuro Book RP 的设计影响

### 推荐迁移模型

第一阶段转换时，建议把 ST 卡拆成以下语义层：

```text
reference/silly-tavern/{card-slug}/
|-- raw/
|   |-- source.png
|   |-- card.json
|   `-- preset.json
|-- inspect.md
`-- conversion-plan.md

roleplay/
|-- GM.md
|-- sessions/
|   `-- current.md
|-- cast/
|   `-- mapping.md
|-- imports/
|   `-- silly-tavern/{card-slug}/
|       |-- dynamic-prompt.md
|       |-- initvar.md
|       |-- scripts.md
|       `-- status-ui.md
`-- variables/
    |-- current.json
    |-- schema.json
    |-- descriptions.json
    |-- update-rules.md
    `-- history.jsonl
```

含义：

- `reference/.../raw/` 保存原始证据，不参与运行。
- `lorebook/**` 只放稳定设定和可检索知识。
- `roleplay/GM.md` 放 RP 运行口径、叙事约束、GM 行为准则。
- `roleplay/sessions/current.md` 放当前局面和短期会话状态。
- `roleplay/imports/...` 保存 ST 动态机制的解释和未执行迁移内容。
- `roleplay/variables/current.json` 表示当前状态。
- `roleplay/variables/schema.json` 表示结构和约束。
- `roleplay/variables/descriptions.json` 保存 ValueWithDescription 的说明文本。
- `roleplay/variables/update-rules.md` 保存 MVU / EJS 中的变量更新规则。
- `roleplay/variables/history.jsonl` 保存未来受控写入的 patch 和 reason。

这不是立即实现 runtime 的要求，而是转换 skill 的目标结构。

### ST 作用域到 Neuro Book 的映射

| ST / 插件作用域 | 语义 | Neuro Book 第一阶段建议 |
| --- | --- | --- |
| `chat` variables | 当前聊天全局状态 | `roleplay/variables/current.json` 或 `roleplay/sessions/current.md` |
| `message` variables | 某楼层或 swipe 的状态快照 | `roleplay/variables/history.jsonl` 和会话日志 |
| `character` variables | 角色卡绑定状态 | `roleplay/variables/characters/{slug}.json` 或角色 lorebook 附注 |
| `script` variables | 某脚本内部状态 | `roleplay/imports/.../scripts.md`，默认不运行 |
| `extension` variables | 插件设置或插件状态 | `reference/.../raw/`，默认不迁移 |
| ST-Prompt-Template `global` | 全局模板变量 | 暂不自动迁移，需人工确认作用域 |
| ST-Prompt-Template `local/cache` | 单次模板执行缓存 | 不迁移为持久状态 |
| ST-Prompt-Template `initial` | 初始变量 | `roleplay/variables/current.json` 草案 |

### 转换分类规则

处理 worldbook entry 时按以下顺序分类：

1. 标题或 comment 含 `[InitVar]`、内容含 `<initvar>`：变量初始化。
2. 标题或 comment 含 `[InitialVariables]`、内容开头含 `@@initial_variables`：模板初始变量。
3. 标题或 comment 含 `[mvu_update]`、内容含 `<UpdateVariable>`、`_.set(`、`<json_patch>`：变量更新规则。
4. 标题或 comment 含 `[GENERATE:*]`、`@INJECT`、内容开头含 `@@generate_*`：生成 prompt 控制。
5. 标题或 comment 含 `[RENDER:*]`、内容开头含 `@@render_*`、`@@iframe`、`@@message_formatting`：渲染/UI/状态栏。
6. 内容含 `<%`、`setvar(`、`getvar(`、`incvar(`、`jsonPatch(`、`patchVariables(`：EJS 动态逻辑。
7. 内容开头含 `@@if`：条件世界书条目。
8. 普通角色、地点、势力、规则、事件、背景：稳定设定，可进入 `lorebook/**`。

一条 entry 可命中多类。转换报告要保留所有命中项，不要只选一个标签。

### 第一阶段应该借鉴的点

- 分离稳定设定、运行状态、显示状态和本轮变更原因。
- 外部卡先归档到 `reference/silly-tavern/{card}/raw/`，再生成 `inspect.md` 和 `conversion-plan.md`。
- 对 MVU/EJS/脚本条目标记风险和语义，不默认执行。
- 对纯文字条目优先导入 `lorebook/character`、`lorebook/location`、`lorebook/faction`、`lorebook/rule`、`lorebook/note`。
- 把 RP 运行口径放入 `roleplay/GM.md`，把当前局面放入 `roleplay/sessions/current.md`。
- 把角色到 agent/subagent 的映射放入 `roleplay/cast/mapping.md`。

### 第一阶段不应该做的点

- 不执行 SillyTavern 卡里的任意 JS。
- 不复刻 iframe、脚本按钮、状态栏 HTML、外部 API 请求或浏览器插件生命周期。
- 不把 `[GENERATE]`、`@INJECT`、`@@if` 等动态提示词控制直接塞进稳定 lorebook。
- 不把 MVU 变量系统一次性实现为完整 runtime。
- 不把预设 JSON 误判为角色卡。

### 后续值得做的点

- 泛用自然语言编辑工具：输入目标文件、自然语言操作说明、可选上下文消息数，由轻量模型产出受控 patch 或 JSON Patch。
- RP 变量系统：支持 `stat_data`、`delta_data`、schema、更新原因和人类可读显示。
- 受控生命周期 hook：类似 MVU 的 command parsed / before write / after write，但不允许任意用户 JS。
- ST 卡 inspect 工具：识别 worldbook 条目类别、MVU blocks、EJS blocks、regex scripts、tavern_helper scripts、prompt injection、render-only 状态栏。
- JSON Patch 写入工具：读取 `current.json`，校验 `schema.json`，应用 patch，追加 `history.jsonl`。
- 额外模型状态更新：用最近两轮对话、当前变量、`update-rules.md` 生成 JSON Patch，失败时不改状态。
- 状态显示生成：从 `current.json` 和最近 `history.jsonl` 生成 Markdown 状态摘要，而不是执行 HTML 状态栏。

## 转换检查清单

处理一张 ST 卡时，至少检查：

- `reference` / `spec_version` / `data.name`
- `data.description`、`scenario`、`first_mes`、`mes_example`
- `data.character_book.entries`
- 条目 `comment` 是否包含 `[InitVar]`、`[mvu_update]`、`[mvu_plot]`、`[GENERATE:*]`、`[RENDER:*]`、`@INJECT`、`@@`
- 条目内容是否包含 `<% ... %>`、`<UpdateVariable>`、`<initvar>`、`<json_patch>`
- `data.extensions.regex_scripts`
- `data.extensions.tavern_helper.scripts`
- `data.extensions.tavern_helper.variables`
- `data.extensions.depth_prompt`
- 预设 JSON 是否只包含 `SPreset`、`regex_scripts`、`tavern_helper`，而不是角色主体

输出 inspect 时建议包含：

- 概览：卡名、spec、worldbook 数量、启用数量、constant 数量。
- 静态设定候选：可直接导入 lorebook 的 entries。
- 变量初始化：`[InitVar]`、`<initvar>`、`[InitialVariables]`、`@@initial_variables`。
- 变量更新：`<UpdateVariable>`、`_.set`、`_.add`、JSON Patch、`[mvu_update]`。
- 条件和动态模板：`<%`、`@@if`、`getvar/setvar/incvar/decvar`、`jsonPatch/patchVariables`。
- prompt 控制：`[GENERATE:*]`、`@INJECT`、`@@generate_*`、`depth_prompt`。
- UI/渲染：`[RENDER:*]`、`@@render_*`、`@@iframe`、状态栏 HTML、隐藏正则。
- 脚本：`regex_scripts`、`tavern_helper.scripts`、脚本按钮、监听事件。
- 风险：外部请求、读写设置、修改消息、删除数据、安装扩展、执行 slash command。
- 转换计划：哪些写入 `lorebook/**`，哪些留在 `roleplay/imports/**`，哪些需要人工确认。

## 样本卡注意点

当前样本卡不能假定为“单角色卡”：

- `公立育露学园/2.28_v1--reload.png`：中等复杂度，含 regex 和 tavern_helper scripts，可作为第一版转换实验。
- `命定之诗/v4.2.1.png`：超大世界书，含大量动态机制，适合作为压力测试。
- `碧蓝档案/V1.5_1.png`：大型多角色 RP 卡，适合测试角色/地点/规则拆分。
- `命定之诗/命定之诗Kemini5-3.8.json`：预设 JSON，不是角色主体；应作为 preset/dynamic prompt 材料处理。

对这三张卡，第一阶段目标是 inspect 和转换计划，不是运行等价。

## 推荐落地文档

后续 roleplay skill 可引用本研究文档，而不是把第三方插件细节全文塞进 skill 正文。推荐拆分：

- `RP模式` skill：只讲 Neuro Book 如何运行 RP。
- `RP目录初始化` skill：只创建和维护 `roleplay/` 结构。
- `SillyTavern角色卡转换` skill：读取本研究文档，执行 inspect 和转换计划。
