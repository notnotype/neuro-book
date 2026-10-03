# Profile TSX 介绍

TSX Profile 是 NeuroBook 编写 Agent profile 的主要方式。它使用 TSX 作为上下文模板语言，表达一个 profile 的 system prompt、history、dynamic context、runtime reminder 和编译策略。

如果你只是使用 NeuroBook，不需要写 TSX。你只有在创建自定义 profile、修改内置 profile 或维护 user-assets 时才需要读这一组文档。TSX Profile 的价值是让 Agent 上下文保持类型安全、可预览、可检查，并为低代码编辑和可视化辅助维护提供结构基础。

## 最小结构

一个 TSX profile 的 `context()` 返回 `<ProfilePrompt>`：

```tsx
<ProfilePrompt>
    <System>你是一个专用 Agent。</System>
    <HistorySet>
        <Message>
            <SkillCatalog />
        </Message>
    </HistorySet>
    <ModelContext>
        <Message>
            <SqlSchemaSummary />
        </Message>
    </ModelContext>
    <AppendingSet>
        <WorkspaceFocusReminder />
    </AppendingSet>
</ProfilePrompt>
```

四个区域的直觉：

- `System`：长期身份和职责。
- `HistorySet`：History，session 缺少前缀时写入；已有前缀时不每轮重复。
- `ModelContext`：Dynamic Context，只给本轮模型看的临时上下文。
- `AppendingSet`：Reminder，贴近当前用户输入、通常会写入历史的运行期提醒。

## 编译和运行

TSX 源文件不是 runtime 真相源。运行时使用 `.compiled` artifact。

修改 profile 后，需要执行 check / compile，否则运行时仍在用旧产物。写自己的 profile 用 runtime CLI：

```bash
profile check agent.example      # 只校验
profile compile agent.example    # 产出 .compiled，运行时才生效
profile preview agent.example    # 看模型实际收到的 context
```

在仓库里开发内置 profile 时加 `--system`：

```bash
bun scripts/build/profile.ts compile builtin/leader.default.profile.tsx --system
```

可视化编辑用 TSX Profile 工作台。注意它的入口只在 **User Assets 模式**下出现（顶栏切到用户资产后才可见），普通小说项目的顶栏里没有这个按钮。

## 继续阅读

- [从零写一个 Profile](./authoring.md)
- [节点说明](./nodes.md)
- [示例](./examples.md)
- [Profile Guide](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/profile-guide.md)
- [Agent 上下文构成](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/context.md)
