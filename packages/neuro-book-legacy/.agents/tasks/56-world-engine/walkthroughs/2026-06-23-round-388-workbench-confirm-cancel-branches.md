# Round 388 - Workbench Confirm Cancel Branches

## Context

Round 385-387 已把主 Workbench 高风险确认迁到应用内 Dialog，并补验了 Slice Composer 关闭和内部 `新建模式` 的取消分支。本轮继续补验剩余常见取消分支：

- Workbench 顶部关闭。
- 打开主体系统工作区文件。
- 删除当前 slice。

本轮只做真实浏览器验收，不改代码。

## Scope

- Project：`workspace/ming-ding-zhi-shi-2`
- URL：`http://localhost:3001/?project=workspace%2Fming-ding-zhi-shi-2`
- 不点击保存。
- 不点击删除确认。
- 不写 Project SQLite。

## Browser Acceptance

### 1. Workbench 关闭取消

步骤：

1. 打开主 IDE 顶部 `World` 入口。
2. 点击 `编辑 Slice` 打开 Slice Composer。
3. 将 title 改为 `[验收草稿-确认取消分支] Round 388`。
4. 页面出现 `当前有未保存草稿`。
5. 点击顶部 `world-workbench-close`。

结果：

- 出现应用内 Dialog：
  - title：`World Engine 草稿未保存`
  - message：`当前 Workbench 有未保存内容：Slice Composer 草稿。确定关闭并放弃吗？`
- 点击 `取消` 后：
  - Workbench 仍可见。
  - Slice Composer 仍可见。
  - title 仍为 `[验收草稿-确认取消分支] Round 388`。
  - `当前有未保存草稿` 仍可见。

### 2. 打开工作区文件取消

步骤：

1. 放弃上一步会话草稿并关闭 Composer，让底层 Workbench 可操作。
2. 在 Inspector metadata title 中输入 `[验收草稿-打开文件取消] Round 388`。
3. 页面出现 `metadata-draft-diff`。
4. 点击左栏可见主体卡片的 `events` 文件入口。

结果：

- 出现应用内 Dialog：
  - title：`World Engine 草稿未保存`
  - message：`当前 Workbench 有未保存内容：1 个 metadata 草稿。打开工作区文件会关闭 Workbench 并放弃这些会话草稿，确定继续吗？`
- 点击 `取消` 后：
  - URL 仍为 `http://localhost:3001/?project=workspace/ming-ding-zhi-shi-2`。
  - Workbench 仍可见。
  - `metadata-draft-diff` 仍可见。
  - Inspector title 草稿值仍为 `[验收草稿-打开文件取消] Round 388`。

### 3. 删除 slice 取消

步骤：

1. 在同一个 Workbench 会话中点击顶部 `删除 Slice`。

结果：

- 出现应用内 Dialog：
  - title：`删除 World Engine Slice`
  - message 包含 `确定要删除 slice`
- 点击 `取消` 后：
  - 删除 Dialog 关闭。
  - Workbench 仍可见。
  - `删除 Slice` 按钮仍可见。
  - 当前选中 slice `[验收] 薇洛丝意识到自己未被重点监视（已编辑）` 仍可见。
  - 先前 metadata 草稿仍可见。

## Verification

- 真实浏览器验收通过。
- 临时 `bunx nuxt dev --port 3001` 已关闭。
- 已确认 `3001` 端口无监听。
- 本轮没有运行测试；没有代码改动。

## Actual vs Plan

- 计划：补验 Workbench 关闭、打开工作区文件、删除 slice 三条应用内确认取消分支。
- 实际：三条均通过。
- 与计划出入：为了测试“打开工作区文件前取消”，先放弃了 Composer 会话草稿，改用 Inspector metadata 草稿触发 Workbench 草稿保护；这更贴近打开文件时底层 Workbench 可操作的真实场景。

## Follow-up

- 主 Workbench 应用内确认取消分支已覆盖主要路径。
- 独立 `/world-engine.preview` 删除 slice 仍保留原生 `window.confirm`；是否迁移应单独决策。
- 下一步可回到更高层作者流观察：主体语境、subject filter、主体文件建议和连续推演之间是否还有概念混淆。
