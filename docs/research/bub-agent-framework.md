# Bub Agent Framework 使用研究

## 背景

当前这份研究关注的是 `.agent/workspace/bub` 里的 Bub 框架：它不是单纯的模型封装层，而是一套 hook-first 的 agent runtime，外层管渠道、技能、工具、配置，内层把一次 turn 交给 `republic` 驱动的 tape/context/LLM loop。

和 Pi 那份研究相比，Bub 更像“可拼装的运行时外壳”：

- 入口是 `pluggy` hooks，而不是一个固定的 agent class。
- 历史记录走 append-only tape，不把会话状态塞进 mutable session 对象里。
- Channels、Skills、Tools 三条 surface 分开，彼此解耦。
- 默认能力已经能跑 CLI、Telegram、`AGENTS.md`、内建工具和子 agent。

对 Neuro Book 来说，这份研究的重点不是“能不能直接换掉现有 agent”，而是：

- 它的 hook 组织方式值不值得借鉴。
- tape/context 语义能不能帮助我们收敛历史、分支和 handoff。
- skills / tools / channels 的分层是否更适合我们现在的 runtime 边界。

## 包结构

Bub 是一个 Python 包，核心实现集中在 `src/bub`，站点和文档放在 `website`，测试覆盖也比较完整。

大致分层是：

- `src/bub/framework.py`：turn 级框架核心，负责加载 hooks、处理 inbound、分发 outbound。
- `src/bub/hook_runtime.py`：pluggy 执行器包装，负责 call_first / call_many / 错误隔离。
- `src/bub/builtin/agent.py`：真正的 agent loop，依赖 `republic` 做 LLM、tool use、stream 和 handoff。
- `src/bub/builtin/hook_impl.py`：默认 hooks 实现，把框架、agent、channels、tape、prompt 串起来。
- `src/bub/builtin/tools.py`：内建工具，包含 bash、fs、skill、tape、subagent、web.fetch。
- `src/bub/skills.py`：skills 发现、前置格式校验、prompt 渲染。
- `src/bub/channels/*`：CLI、Telegram 和 channel manager。

`pyproject.toml` 也说明它是个完整产品型框架，不是 demo：

- Python 3.12+
- 依赖里直接带了 `pluggy`、`typer`、`republic`、`python-telegram-bot`、`rich`、`prompt-toolkit`
- 还提供 CLI entrypoint `bub = "bub.__main__:app"`

## hook-first runtime

Bub 的最核心判断是：一次 turn 的每个阶段都应该是 hook。

`BubFramework.process_inbound()` 的主流程是：

```text
resolve_session → load_state → build_prompt → run_model
                                                   ↓
              dispatch_outbound ← render_outbound ← save_state
```

这个设计的关键不只是“可扩展”，而是它把 turn 生命周期拆成了稳定边界：

- `resolve_session`：先把 inbound 归属到 session。
- `load_state`：把外部状态汇入本 turn 的 state。
- `build_prompt`：构造模型输入。
- `run_model` / `run_model_stream`：执行模型。
- `save_state`：无论成功失败都要收尾。
- `render_outbound` / `dispatch_outbound`：把结果发回渠道。

这里最值得注意的是几个语义：

- `resolve_session` 和 `build_prompt` 都是 `firstresult`，后注册插件优先。
- `load_state` 和 `save_state` 是广播式。
- `save_state` 包在 `finally` 里，保证 turn 收尾一定发生。
- `render_outbound` 有 fallback：如果没人渲染，就把 `model_output` 包成一个默认 outbound。
- `on_error` 是观察者语义，单个 observer 失败不会挡住其他 observer。

这套边界比“一个大 agent class 里硬塞 provider、工具、消息、持久化”清楚很多。

## hook runtime

`src/bub/hook_runtime.py` 做的事很朴素，但很实用：

- 按 pluggy 的注册顺序反向迭代，让后注册插件优先。
- 提供 `call_first` / `call_many` / sync 版本。
- 统一处理 async/sync hook。
- 对 `on_error` 做隔离，避免 observer 自己再炸掉。

另一个细节是它对 `run_model` 和 `run_model_stream` 的适配：

- 非流式时，如果只有 stream hook，就把 `text` 事件拼接成字符串。
- 流式时，如果只有非流式 hook，就包成单 chunk stream。

这让实现者只要选一种模型输出形式就够了，不需要把两条路径都写满。

## tape 与 context

Bub 的上下文模型是它和一般 agent 框架差异最大的地方。

`src/bub/builtin/tape.py` 里，`TapeService` 提供了：

- `session_tape()`：按 workspace + session 计算 tape 名。
- `ensure_bootstrap_anchor()`：首次运行前补一个 `session/start` anchor。
- `handoff()`：写新的 anchor，作为 phase transition。
- `fork_tape()`：支持 fork/merge-back。
- `reset()` / `search()` / `info()` / `anchors()`：给运行时和 operator 用。

这里最重要的概念是：

- tape 是 append-only。
- anchor 不是删除点，只是重建上下文的起点。
- handoff 是“带状态的阶段切换”，不是清历史。
- context 不是继承出来的对象，而是每次重新构造的视图。

`default_tape_context()` 还把 tape entry 映射成 OpenAI 风格消息，说明 Bub 已经把“历史存储”和“模型上下文”明确拆开了。

对于 Neuro Book，这个模型很有参考价值：

- 适合解决 context 越来越长、历史越乱的问题。
- 适合把总结、分支、handoff 变成显式结构，而不是只靠 prompt 约定。
- 适合把 UI/工具事件和 LLM message 分开存。

## agent loop

真正的 loop 在 `src/bub/builtin/agent.py`。

它做的事情大概是：

1. 取 settings。
2. 构造 tape。
3. 进入 fork tape 上下文。
4. 允许 internal command（`,` 开头）。
5. 循环执行 `_run_once()`，直到得到 text、continue、或者出错。

几个比较关键的点：

- 支持 streaming 和 non-streaming 两条输出路径。
- 支持工具自动调用。
- 支持 `Continue the task until all targets are completed.` 这种继续型重试。
- 支持 context overflow 自动 handoff，再用更短的历史重跑一次。
- 允许通过 `allowed_skills` / `allowed_tools` 收窄本轮能力面。

这个 loop 的价值不只是“能跑模型”，而是它已经把：

- tool use
- command mode
- subagent
- handoff
- tape search

揉成了一个统一的执行面。

## skills

Bub 的 skills 机制是标准 Agent Skills 风格，不是 Python API。

`src/bub/skills.py` 做了三件事：

- 从 project / global / builtin roots 发现 `SKILL.md`
- 校验 frontmatter
- 把 skills 渲染进 prompt

它还会展开 `\${config.xxx}` 这类模板变量，说明 skills 不只是静态文本，已经和运行时配置有了轻量绑定。

内建 `skill` tool 允许模型按名读取 skill 内容，这一点很重要：

- skills 是给 operator 的操作手册。
- 只有在需要时才展开全文。
- 不是所有 skill 都默认灌进系统提示词。

这和我们现有“技能目录 + prompt 注入”的思路很接近，迁移成本不会特别高。

## tools

`src/bub/tools.py` 把工具注册做得比较直接：

- `@tool` 装饰器会把函数注册进全局 `REGISTRY`
- 工具名可以有 model-facing alias
- `render_tools_prompt()` 会生成可读工具清单
- `model_tools()` 会把工具名转成模型侧名字

内建工具覆盖面挺完整：

- `bash` / `bash.output` / `bash.kill`
- `fs.read` / `fs.write` / `fs.edit`
- `skill`
- `tape.info` / `tape.search` / `tape.reset` / `tape.handoff` / `tape.anchors`
- `web.fetch`
- `subagent`
- `help` / `quit`

这里最值得借鉴的是它的子 agent 设计：

- 子 agent 可继承当前 session。
- 也可以走临时 session。
- 可以限制可用 tools / skills。

这比把“子任务”当成普通 tool call 更稳，因为它把权限边界说清楚了。

## channels

`src/bub/channels/manager.py` 把 channels 当成独立 surface，而不是 agent 内部的一个附属功能。

它的职责是：

- 收消息。
- 做 debounce / active window 控制。
- 交给 `framework.process_inbound()`。
- 再把 outbound 发回具体 channel。

内建 channel 有 CLI 和 Telegram。`Channel` 接口还支持 `stream_events()`，所以流式输出可以在 channel 层做增量渲染。

这个分层很适合多入口场景：

- 同一个 runtime 可以接 CLI、Telegram、以后也可以接 WebSocket / webhook。
- 入口的差异留在 adapter，核心 turn 不变。

## 默认插件

`src/bub/builtin/hook_impl.py` 是 Bub 的默认 glue layer。

它把很多东西串起来了：

- `resolve_session`：优先读 message.session_id，否则用 `channel:chat_id`
- `load_state`：打开生命周期、初始化 `_runtime_agent`
- `build_prompt`：处理命令、上下文前缀、图片媒体
- `run_model` / `run_model_stream`：委托给 `Agent`
- `render_outbound`：把 model_output 组装成 `ChannelMessage`
- `dispatch_outbound`：交给 outbound router
- `system_prompt`：默认提示词 + workspace 下 `AGENTS.md`
- `provide_tape_store`：默认文件存储
- `provide_channels`：注册 CLI / Telegram

这说明 Bub 的默认插件其实已经是一个完整产品骨架，不只是示例。

## 对 Neuro Book 的参考价值

如果把 Bub 当作参考实现，我会这么看：

### 值得借鉴

- hook-first turn pipeline，适合把复杂 runtime 拆成稳定阶段。
- tape / anchor / handoff 语义，适合处理长历史和 phase 切换。
- skills / tools / channels 分层，适合收敛权限和职责边界。
- `save_state` 强制 finally 收尾，适合做可靠的持久化与资源关闭。

### 不建议直接照搬

- 直接把 `republic` 作为唯一核心依赖，风险很大。
- 把 tape 文件结构和 current workspace 绑定得太紧，会限制我们现有 DB / 线程模型。
- 内建 `bash` / `fs` / `web.fetch` 这种通用工具集，放到 Neuro Book 里要按产品边界重新裁。

### 更现实的切法

第一阶段可以只吸收边界，不吸收实现：

- 保留我们自己的数据层和 provider 层。
- 借鉴 Bub 的 turn pipeline 分段方式。
- 把 history / anchor / handoff 语义单独提出来。
- 继续让 skills 保持 Agent Skills 标准。

## 结论

Bub 不是“另一个聊天框架”，而是一个围绕 shared-environment 协作场景设计的运行时。

它最强的地方不是工具多，而是它把：

- turn
- state
- tape
- skills
- tools
- channels

这些东西拆成了清楚的边界。

如果 Neuro Book 下一轮想收敛 agent runtime 的复杂度，Bub 这套思路值得认真借鉴，尤其是 hook-first pipeline、append-only history、以及把 operator / model / channel 分层这三点。

