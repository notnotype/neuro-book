# t15 计划：问答的思考摘要与输入框的 @ 引用

## Context

开发者 2026-10-23 试用 t13 的问答页后提出（[t13 README](../t13-qa-web/README.md) 当前状态最后一条）：

- 看不到思维链。查明：推理档照常发出（`reasoning_effort: "xhigh"`），但 GPT 系列经 Chat Completions 接口不回思考内容；开发者那次对话的日志里 6 条模型回复全是工具调用。
- 输入框没有 `@` 引用。开发者早先对 Composer 提过 `@` 引用的要求；t13 计划按第 2 轮设计审查网页第 14 条没有登记任何触发字符，没有问开发者。

开发者的决定（2026-10-23，会话内）：

1. 配置可以选走 Responses 接口（GPT 回思考摘要）。
2. `@` 引用人物与对象、章节与段落两样都要；模型看到的是带 id 的引用。

依据：[story/qa.md](../../../../../docs/specs/story/qa.md)（配置、问答页）、[story/viewer.md](../../../../../docs/specs/story/viewer.md)（问答页）、[ui/prompt-editor.md](../../../../../docs/specs/ui/prompt-editor.md)（引用的文字写法 `[名称](目标)`、触发菜单）、[ui/agent-conversation-view.md](../../../../../docs/specs/ui/agent-conversation-view.md)（输入框的触发登记）。

## 技术选型

无新增依赖。Responses 接口用 OMP 现成的 `openai-responses`（本机假端点实测：请求发到 `/v1/responses`，带 `reasoning: {effort, summary: "auto"}`）；触发菜单用 nb-agent-ui 的 `triggers` 登记与 `services.resolveTriggerMenu`；引用小块用 nb-markdown 缺省的目标分类（带方案的非外部地址都是引用小块，点击发 `reference`）。

## 关键设计

### 配置：`src/contract/config-schema.ts`、`src/qa/harness-model.ts`

- 问答模型加可选的 `api`：`"chat"`（缺省，Chat Completions）或 `"responses"`（Responses）。表单标签“接口”，说明写“GPT 系列要看思考过程选 Responses；服务要支持 `/v1/responses`”。
- `configuredModel` 按它选 `openai-completions` 或 `openai-responses`；`probeModel`（测试连接）随之走同一个接口。抽取的模型不加（抽取不显示过程）。
- `nbstory config` 的显示加一行接口。

### 测试端点：`testing/openai-endpoint.ts`

- 加 Responses 的流式回复：思考摘要、文字、工具调用三种事件，形状照 OMP `openai-responses` 解析的事件（`response.reasoning_summary_text.delta` 等）。路径按请求区分，现有 Chat Completions 的脚本不变。

### 引用的目标

- 人物、对象：`[名字](entity://<id>)`；段落：`[37.8](paragraph://37.8)`（与出处链接同一种写法）；章：`[第 37 章 标题](chapter://37)`。插入文字用 nb-markdown 的 `promptReferenceText`。
- 显示：问答页的 Markdown 宿主不给目标分类，三种都按缺省显示成引用小块；输入框里与已发出的问题里点小块发 `reference.open`。
- 打开：`QaPage.openTarget` 现有 `paragraph://`、`entity://`，加 `chapter://`：打开这一章开头的原文抽屉（`book.openParagraph(章, 1)`，决定 3）。

### 问答页的 `@` 菜单：新文件 `src/web/qa/mentions.ts`，`QaPage.vue` 接线

- 登记一个触发字符 `@`（registry 的 `triggers`），给 `services.resolveTriggerMenu`。只登记 `@`，不登记 `/`、`$`。
- 菜单按查询分两组，按这个对话的阅读位置 P 取（新对话用查看器当前位置，续问用对话记下的 P）：
  - **人物与对象**：`entities.list({at: P, query, limit: 8})`，显示名字、类别与常用称呼；查询按 P 建视图（`core/api.ts` 的 `new BookView(index, at)`），晚于 P 才出现的对象不在名单里，不剧透；
  - **章节与段落**：查询是数字时，`37` 列第 37 章，`37.8` 列这一段；查询是文字时按章标题筛（`book.info` 的目录，取一次缓存）。晚于 P 的章与段落显示但不能选，说明“还没读到”。
- 查询为空时列出提及最多的几个人物与当前这一章（决定 4）。取数是异步的：先给 `loading` 菜单，数据到了换一个新的菜单函数（端口约定）；每次查询在 150ms 内只发一次请求，旧请求的结果丢掉。
- 对话列表与页头显示首问时，把引用写法换成名称（`[苏天晴](entity://…)` 显示为“苏天晴”）：`src/web/qa/` 加一个小函数，列表与页头共用。

### 模型怎么读引用：`src/qa/rules.ts`（问答规则）

- 规则加一条：问题里的 `[名称](entity://id)` 是用户指定的对象，查询时直接用这个 id，不再按名字找；`paragraph://章.段`、`chapter://章` 是用户指定的段落与章，需要原文时按它读。
- 命令行的 `nbstory ask` 也按同一条规则读（问题里手写同样的写法即可），不另做。

## Spec 与文档改动

- `story/qa.md`：配置加 `api`；问答规则加引用；网页的 `@` 菜单与三种目标；验收场景加两条（Responses 接口的思考摘要进日志、带引用的问题按 id 查）。
- `story/viewer.md`：问答页输入框的 `@` 菜单、`chapter://` 的打开方式、列表首问显示名称。
- `src/web/qa/` 新文件按需写同名说明；`packages/nb-story/AGENTS.md` 不变。

## 切片

1. **Responses 接口**：配置、`harness-model`、测试端点、单测（请求路径与 `reasoning.summary`、思考摘要写进日志、`config.test` 走同一接口），Spec。提交。
2. **`@` 引用**：`mentions.ts` 与单测（分组、数字与文字查询、晚于 P 不能选、过期请求丢弃）、`QaPage` 接线、`chapter://`、首问显示名称、问答规则，Spec。e2e 一条：输入 `@` 选人物与段落，发出后模型收到的问题里有 `entity://` 与 `paragraph://`，点问题里的小块开抽屉。提交。
3. **真实模型冒烟**（开发者已同意走 Responses 时真调一次）：中转渠道余额恢复后，在设置页把接口改成 Responses、测试连接，再问一题看过程里有没有思考。relay 不支持 `/v1/responses` 时如实报告，接口选项照样保留。

## 验收映射

切片 1、2 的 Spec 编号写完 Spec 后补；e2e 在 `e2e/qa.e2e.ts`，单测在 `src/qa/`、`src/web/qa/`。

## 验证

`bun run --cwd packages/nb-story typecheck`、受影响单测、`e2e/qa.e2e.ts`；切片 2 后跑 nb-story 全量 e2e。

## 不做与风险

- 不给抽取模型加接口选项。
- 不做 `/`、`$`。
- 风险：网关可能不支持 Responses，或只回空的思考摘要；第 3 步才知道。
