---
schema: nbook.task/v2
taskId: t58-markdown-studio-migration
role: tasker
---

# 编辑器叶接入：Markdown Studio

**状态：合同已备，待开发者放行实施**（实施需停 3001：编辑器接入会大范围热更新，按既有约定「先停 → 实施验证 → 完成后同 root 重启」）。放大镜下的依据来自 [清单 §2.2](../../view-migration-inventory.md)。

## 结果

Project 态 editor 叶渲染真实 Markdown Studio（不再占位），写作主链路可用：文件树双击/打开文件 → Studio 显示正文 → 富文本/源码双模式切换 → 编辑保存落盘；编辑器展示偏好归 user/local 记录，`novel.ide.local` 的对应字段退役。

## 范围

- **A 挂载**：把 `MarkdownStudioWorkbench.vue`（233 行，当前 `index.vue:6` 死 import）接入 editor 叶，替换占位块 `index.vue:2627-2633`；按 t55 的容器/视图路径登记（`product-catalog.ts` 内置视图 + `WorkbenchViewHost`），不新建第二套宿主机制。
- **B 打开文件链路**：文件树打开文件的意图接到 Studio（t55 目前给的是「编辑器叶还没迁入」提示，本 Task 用真实行为替换）；标签条/活动文件按 Project 分区保持既有语义（领域恢复态排除项，不入 Storage）。
- **C 展示偏好归属**：`viewMode` / `markdownEditorPreferences` / `monacoEditorPreferences`（现于 `novel.ide.local`，`novel-ide.ts:1978-1980`）→ user/local 记录；用既有 `legacy-record-migration.ts` 原语一次性迁移（记录缺失才条件初始化、回读一致后才删旧字段），并在迁移完成后把这三个字段从 `pick` 移除，保持单写者（刷新两次验证）。
- **D 旧实现删除**：`index.vue:2627-2633` 占位块；页面对 studio 的旧 resize/布局读取残留（见 [source map](../../storage-consumer-source-map.md)）；`index.vue:6` 由死 import 转为真实使用。
- **E Lab 覆盖**：为 `MarkdownStudioWorkbench` 补同名 `.md` 与确定性 Lab 条目；若编辑器内核（TipTap/Monaco）在 Lab 无法确定性挂载，允许按规则标注不可挂载并**给出理由与替代验证**（不得静默跳过）。

## 排除

- 不改 TipTap / Monaco 版本与其内核行为；不动 `common/form/StructuredTextEditor.vue` 的既有消费者（plot、profile-template-editor）。
- 不做右叶 Agent 面、不做 World Engine 整页搬迁、不做命令系统。
- 不改正文 authority（`/api/workspace-files/*`）；正文/草稿/未保存内容**不进 Storage**。
- 不新增裸 `localStorage`/`sessionStorage`。

## 实现要求

1. **单写者**：三个偏好字段只有记录一条写路径；旧桶字段在迁移后退出 `pick`，不再有第二 writer。
2. **失败可见**：打开文件失败、保存失败、记录写入失败都必须给出可理解反馈（沿用 `layout-session`/`files-view-session` 的既有诊断与重试范式），不得静默。
3. **首读门禁**：编辑器偏好首次读取完成前不写默认值；缺失记录不落盘默认。
4. **几何一致**：editor 叶尺寸继续由切片 4 的 project/local 记录承担（`layout-session.ts`），不得新增第二套布局写入。
5. **不打断 3001 的约束**：实施期间按 Leader 给的窗口进行；服务端模块改动（如需注册定义）**成批一次落盘**并提前报 Leader。

## 验证与交付

- 聚焦测试：打开文件 → 内容装载、双模式切换、保存链路、偏好记录（首读门禁/条件初始化/旧字段迁移与回读验证/冲突不静默）、单写者。
- 真实浏览器（必做，窗口内）：Project 态 editor 叶渲染 Studio；双击文件 → 显示正文；双模式切换；编辑并保存后磁盘/文件 API 侧可见；刷新两次只有一个 writer 且偏好恢复；失败路径可见（至少一次真实失败注入）。
- Lab：按 §E 交付并保持 Lab smoke 绿色（跑法：对运行中的 3001 只读跑 `component-lab --suite all`）。
- 报告写 `walkthroughs/implementation.md`：真实命令、cwd、退出码、隔离根与端口、用例数、未运行项与偏差。
- 不提交、不 push；只逐文件 `git add`；不覆盖用户 dirty `app/utils/workbench/descriptors{,.test}.ts`。
- 最终回复具体结果，不返回空文本或句点。

## 继续条件

Leader 复核（typecheck、聚焦测试、Lab smoke、浏览器证据）后提交；随后按清单推进下一项（角色 / Plot）。