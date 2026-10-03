# Profile 介绍

Profile 定义一个 Agent 的行为边界。NeuroBook v3 中，profile 就是 agent 类型：创建 `leader.default`、`writer` 或 `retrieval`，本质上都是创建某个 profile 的 session。

普通用户通常只需要选择 profile；profile 作者则需要理解 TSX Profile DSL、工具权限、输入输出 schema、动态上下文、压缩策略、摘要策略和 Runtime Hooks。

## Profile 包含什么

一个 profile 至少包含：

- `manifest.key`：稳定 profile key，例如 `leader.default`。
- `manifest.name`：用户可见名称。
- `initialSchema`：创建 session 时的输入合同。
- `outputSchema`：需要结构化结果时的输出合同。
- `tools`：这个 profile 的根工具绑定对象，决定模型可见工具 schema 和最大工具权限。
- `toolKeys`：可选，收窄主 run 实际可执行工具；不声明时等于根 `tools` 的全部 key。
- `context(ctx)`：用 TSX DSL 生成 system、history、dynamic context 和 reminder。与 `prepare` 二选一，同时声明会报错。
- `runtimeDefaults`：只声明摘要、压缩和文件变更预算的出厂默认；Harness 会在运行时叠加 Global / Project 的通用值与 Profile 覆盖。
- `capabilities.creation`：`public` 才允许别的 Agent 用 `create_agent` 拉起；`system_only` 只由 Harness 内部流程创建。
- `home`：这个 profile 的专属资源目录（人设、文风预设、参考资料）。
- `skills.include`：Skill 白名单。catalog 可见性不等于权限，白名单在 prepare 层统一过滤。
- runtime hooks：控制旁路和生命周期行为。

运行策略不属于 `settingsForm`。最终优先级固定为：Harness 默认 < Profile `runtimeDefaults` < Global 通用值 < Global Profile 覆盖 < Project 通用值 < Project Profile 覆盖。判别联合（例如 compaction trigger 与 keep-recent）由更高层整体替换，其余策略按字段继承。

需要结构化结果时，profile 通过 `report_result` 返回。

## 系统 profile 和用户 profile

系统内置 profile 位于：

```text
assets/workspace/.nbook/agent/profiles/builtin/
```

用户覆盖或自定义 profile 位于：

```text
workspace/.nbook/agent/profiles/
```

运行时使用 `.compiled` artifact。保存 TSX 源文件不等于运行时已生效；需要通过 Workbench 或 `profile compile` 编译。

## 常见内置 profile

当前内置 14 个 profile。

**写作主链**：

| Profile | 职责 |
| --- | --- |
| `leader.default` | 普通小说项目的总调度，持有全套剧情读写与世界引擎工具，处理 Skill、writer、retrieval、researcher 和写作流程。 |
| `writer` | 正式正文写作，长期 session 每轮通过 message + payload 指定任务和目标文件。对剧情与世界引擎只读。 |
| `retrieval` | 内容节点召回和候选判断。 |
| `researcher` | 联网研究与来源核验。 |
| `world.engine` | 复杂 World Engine 维护与校验，readwrite 模式。 |
| `director` | 剧情导演。高级手动 profile，不是普通写作的必经节点。 |

**后台与辅助**（不由用户直接创建）：

| Profile | 职责 |
| --- | --- |
| `inline.editor` | Markdown Studio 的 Inline AI，跑独立后台会话。 |
| `summarizer` | 后台生成 session title / summary。 |
| `memory.curator` | 为 `subject_memory_update` 生成记忆补丁。 |
| `leader.assets` | 协助用户理解和维护 user-assets、profile、skill。 |

**RP / 世界模拟**（入口已下线，重新设计中）：

| Profile | 职责 |
| --- | --- |
| `rp.leader` | RP 主持与编剧入口。 |
| `rp.writer` | RP 可见正文渲染。 |
| `simulator.leader` | 世界模拟主管。 |
| `simulator.actor` | 单个 subject 的角色扮演 agent。 |

除此之外还有一类不落目录的 **adhoc profile**：只声明提示词和输出结构的临时 agent，由 workflow 在运行时创建，用完即弃。见 [Workflow 与 Job](/agent/workflow)。

## 继续阅读

- [Leader](./leader.md)：默认 leader 如何调度写作、检索、研究和 RP。
- [Writer](./writer.md)：普通 writer 的正文写作边界。
- [其他 Profile](./other-profiles.md)：retrieval、summarizer、assets、RP profiles。
- [Profile Guide](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/profile-guide.md)：profile 作者主入口。
