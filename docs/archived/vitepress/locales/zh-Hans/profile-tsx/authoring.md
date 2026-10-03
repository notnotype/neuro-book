# 从零写一个 Profile

这一页是端到端路径：建文件 → 写导出 → 编译 → 在界面里用起来 → 出错了怎么查。

## 1. 文件放哪、叫什么

用户 profile 放在 Workspace Root 的 `.nbook` 下：

```text
workspace/.nbook/agent/profiles/<key>.profile.tsx
```

**文件名必须是 `<key>.profile.tsx`**，`<key>` 要和 `profileManifest.key` 一致。不一致会挂 `filename_mismatch`。

不用从空白开始，仓库带了两个模板：

```text
assets/workspace/.nbook/agent/profile-templates/basic-agent.profile-template.tsx
assets/workspace/.nbook/agent/profile-templates/report-agent.profile-template.tsx
```

`basic-agent` 是最小可跑骨架，`report-agent` 带结构化输出。

## 2. 必须导出什么

这是模块契约，缺一项就编译不过：

| 导出 | 必需 | 说明 |
| --- | --- | --- |
| `profileManifest` | 是 | `key`、`name`，可选 `description`、`version`（正整数，递增会触发 profile home 升级） |
| `InitialSchema` | 是 | 创建 session 时的输入合同。不需要参数就写 `Type.Object({})` |
| `OutputSchema` | 是 | 输出合同。没有结构化结果就写空对象 |
| `PayloadSchema` | 否 | 只有需要 `invoke_agent.input` 时才声明 |
| `SettingsSchema` + `settingsForm` | 否 | 需要设置表单时成对声明，运行时用 `ctx.settings` 读合并值 |
| `Initial` / `Payload` / `Output` / `Settings` | 是（对应 schema 存在时） | 用 `Static<typeof XxxSchema>` 推导的类型别名 |
| `default` | 是 | `defineAgentProfile({...})` 的返回值 |

最小骨架见 [示例](./examples.md)。

::: warning 改内置 profile 有额外限制
覆盖内置 profile 时**不允许修改 key 和三个 schema**，否则挂 `builtin_schema_locked`。想改结构就新建一个自己的 profile，不要覆盖。
:::

## 3. 编译

**保存 TSX 不等于生效**。运行时读的是 `.compiled` 产物，源码只是真相源。

```bash
profile check <key>      # 只校验，不产出
profile compile <key>    # 产出 .compiled，这一步之后才真正生效
profile preview <key>    # 看模型实际收到的 context——调 prompt 时最有用
profile status <key>     # 看当前编译状态
```

`profile` 由 `.nbook/agent/bin` 注入 PATH。可选参数：`--all`（批量）、`--project <path>`（项目层 profile）、`--strict-variables`。

在仓库里开发内置 profile 时用完整路径加 `--system`：

```bash
bun scripts/build/profile.ts compile builtin/leader.default.profile.tsx --system
```

`preview` 是最被低估的命令——它把 prepare 之后的真实上下文打出来，能直接看到你的 `Import` 有没有生效、Reminder 落在哪一层。

## 4. 在界面里用起来

这一步和直觉不一样，**新建 Agent 的下拉里不会列出你的自定义 profile**。

三条可用路径：

1. **设成默认 Profile**：设置页的 Agent Profile 面板里指定，之后新建的 Agent 就是它。
2. **让 leader 拉起来**：需要在 profile 里声明 `capabilities.creation = "public"`，然后 leader 就能用 `create_agent` 创建它的 linked session。不声明的话默认只有 Harness 内部流程能创建。
3. **TSX Profile 工作台**：可视化编辑 + 编译 + 预览 + 恢复系统版本。

::: warning 工作台入口只在 User Assets 模式可见
顶栏切到「用户资产」之后才会出现 Profile 工作台按钮。普通小说项目的顶栏里没有这个入口，翻遍也找不到。
:::

## 5. 出错了看哪

profile 会带一个状态和一组 issue code。常见的：

| Code | 含义 | 怎么办 |
| --- | --- | --- |
| `not_compiled` | 从没编译过 | 跑 `profile compile` |
| `compile_stale` | 源码改了但没重编 | 跑 `profile compile` |
| `compile_failed` | 编译失败 | 看错误信息，通常是未知 DSL 节点或类型错 |
| `filename_mismatch` | 文件名和 key 对不上 | 改文件名 |
| `invalid_export` / `schema_missing` | 导出不完整 | 对照第 2 节的表补齐 |
| `builtin_schema_locked` | 试图改内置 profile 的 key 或 schema | 新建自己的 profile |
| `system_profile_shadowed` | 你的 profile 遮蔽了同名系统 profile | 确认是否有意为之 |
| `source_stale` / `dependency_stale` | 依赖的文件变了 | 重编 |
| `compiled_load_failed` | 产物加载失败 | 删掉产物重编 |

**运行时严格拒绝 stale 和 failed 的 profile**——不会拿旧产物凑合跑，所以看到报错就是真的没生效。

## 6. 常见坑

**未知节点直接抛异常**。DSL 的节点表是穷举的，写了表外的名字编译就炸。完整 28 个节点见 [节点说明](./nodes.md)。

**压缩策略不是节点**。写在 `defineAgentProfile({runtimeDefaults: {...}})` 里。

**`context` 和 `prepare` 二选一**，同时声明会报错。

**Skill 白名单是权限，不是可见性**。`skills.include` 在 prepare 层过滤，catalog 里能看到不代表能用。

## 继续阅读

- [节点说明](./nodes.md)：28 个 DSL 节点与分层放置规则。
- [示例](./examples.md)：可直接复制的骨架。
- [Profile Guide](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/profile-guide.md)：完整合同。
- [编译产物机制](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/profile-compiled-artifacts.md)：`.compiled` 格式与发布流程。
