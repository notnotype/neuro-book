---
schema: nbook.task/v2
taskId: t33-plugin-skills
status: done
updated: 2026-11-16
---

# 插件的 Skill 与 SDK 构建

## 目标与范围

插件经贡献点 agent.skills 带上 Skill 目录；插件 SDK 的构建把每个 Skill 的脚本连同 npm 依赖打成单文件，打不进的构建失败并说明原因（t15 第 7 条，2026-11-10 从 t15 拆出）

合同：开工时定；`agent/skills.md`（t15 新建）加插件来源，`agent/contributions.md` 加贡献点 `agent.skills`，插件 SDK 的构建 Spec 加 Skill 打包。

来源：[t15](../t15-skills/README.md) 第 7、9、20 条；[t10](../t10-agent-plugin/README.md)“后续修改”里构建预设的那条。

## 决定

| 编号 | 日期 | 决定 |
|---|---|---|
| 1 | 2026-11-15 | 开发者：t30 之后开 t33 |
| 2 | 2026-11-15 | 开发者确认[计划](plan.md)，末尾 6 个待确认项全部按推荐：一个贡献声明一个装着若干 Skill 的目录；Skill 文件夹里全部 JS/TS 文件都打包；打包后保留原路径与文件名；Python 脚本只在带第三方依赖时构建失败，只用标准库的原样带上；Skill 页分组为我的、各插件、内置；插件 Skill 里有 `package.json` 时标无效 |
| 3 | 2026-11-15 | 开发者：用 autonomous-delivery 推进到 Task 完成 |
| 4 | 2026-11-16 | 开发者批准 Spec 晋升：t33 的条目去掉 planned；t33 完成 |

## 当前状态

2026-11-15 开工。调研了插件构建、清单与贡献点、安装目录，用十个常用 npm 包做了打包实验；[计划](plan.md)已获开发者确认（决定 2）。

设计审查（omp）6 条（阻断 3、重要 3）：成立 4 条、部分成立 1 条，都已改进计划；1 条不成立（Python 的规则是开发者的改判，已在 t15 第 7 条后注明）。处理见 [`evidences/design-review.txt`](evidences/design-review.txt)。两项“接受取舍”记进了 [待确认清单](../../pending-confirmations.md)：查不出按工作目录或环境变量找数据文件的依赖；可选依赖的 `try require` 照样判失败。

切片都已提交（分支 `feat/w00032-t33-plugin-skills`）：

1. `9d7495065`：贡献点 `agent.skills`、平台的插件包查询（`plugin-platform/packages`）、Skill 目录的插件来源（根带 key 与前缀，接收者随贡献的发布与撤回增删）。
2. `94fd8fdb2`：`nbooke build` 把 Skill 的脚本连同依赖打成单文件，打不进的构建失败并写明原因（通用构建预设加“按贡献点的附加构建步骤”）。
3. `7388809c8`：从构建、安装到 `$` 带上与 shell 运行的集成测试；接收者的时序测试。
4. `1d77d32f5`：Skill 页与 Profile 设置按插件分组，例子 `skill-pack` 与场景 9，SDK 的作者文档。
5. `c9740fe57`：收口时架构测试拦下的三处（打包 Skill 的一步挪进作者包 `plugin-sdk/skills-build.ts`；平台注释不提应用名；例子里 Skill 的脚本不按插件代码的规则查）。

实施中与计划不同的几处（计划与 Spec 已同步改）：
- 运行中才登记的插件，它的顶层声明要等接收者下次接上才补交（`runtime/plugins.md` 的已知限制，热插拔还是 planned）。集成测试改成两个插件都在启动时登记，撤回的先后由接收者自己的测试按合同调用。
- 入口脚本自己的 `__dirname`、`__filename` 被 Bun 换成构建机器上的路径（实验），所以也判构建失败，提示改用 `import.meta.dir`。
- 例子 `skill-pack` 的描述从 `/agent` 取 `agentSkills`。`/agent` 只在服务端，仓库里浏览器那份类型检查排除了这个例子（与 `src/sdk/agent.ts` 同理）。作者那边用的是打包后的类型，SDK 打包测试加了一条核对作者的普通 tsconfig 照样通过。

收口验证（master 已并进分支，`01323ef8d`）：
- 应用 `typecheck` 过。
- `test:affected --since master`：Bun 3145 条、Vitest 623 条。第一次有 2 条架构测试失败，修正后重跑架构测试、`plugin-sdk` 全套与插件 Skill 的集成测试都过。
- e2e `agent-skills` 过。`plugins` 的“安装 → 重启后配置项出现……”在 master（`1013647d0`）上同样失败，是既有失败，与 t33 无关。`lab-scenes` 挡在主题编辑器两个场景的 404（t30 收口时已见过），Skill 页的四个场景改用 `nbdev shot` 在手机与自由画布上量：越界、焦点环与外扩环被裁、页面错误都是 0。

实现审查两路已处理，修正单独提交：
- 后端（omp）4 条（重要 4）：都成立、已改（`4c1c77159`）。打包判据改按语法上下文查：`import.meta` 整个被取用、`require` 当值用、文件里自己声明的 `__dirname`；同一个 key 的根换目录也通知。十个常用包重量一次，仍然只有 sharp 被拦。处理见 [`evidences/impl-review-backend.txt`](evidences/impl-review-backend.txt)。
- 前端（Sonnet）8 条（重要 1、建议 7）：都成立、已改（`f75c8c971`）。“已删除或不可用”的提示不再只说放回文件夹；显示名撞了的插件组带上 id；条目按来源区分、插件来源必带所属插件；Profile 里无效的悬停写原因；没打包的原因加去向；长 id 组头折行；Profile 一节补测试。处理见 [`evidences/impl-review-frontend.txt`](evidences/impl-review-frontend.txt)。
- 改完重跑：类型检查、受影响的单元与集成测试 64 条、Profile 与 Skill 页的测试、e2e `agent-skills` 3 条都过；Skill 页场景用 `nbdev shot` 重量，越界与被裁都是 0。

已合入 master（`0f0b5c41d`，`--no-ff`）。合入前 master 又多了桌面设置（25 个文件），与 t33 没有同一个文件，`merge-tree` 试算无冲突；合入后在 master 上重跑应用 `typecheck` 与架构、目录的测试都过。分支与 worktree 已删。

2026-11-16 开发者批准晋升（决定 4）：`agent/skills.md` 输出 30–34、“不承诺”与“时序与寿命”里的两条、场景 9，`runtime/plugin-api.md` 的打包 Skill，`runtime/plugin-code-loading.md` 输出 11 去掉 planned；`agent/skills.md` 的实现合同与证据补上插件来源。t33 完成。

## 下一步

无。待确认清单里 t33 的两条按默认追认。
