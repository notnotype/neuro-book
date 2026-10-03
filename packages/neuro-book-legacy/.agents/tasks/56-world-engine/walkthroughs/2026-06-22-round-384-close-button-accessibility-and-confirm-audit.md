# Round 384 - Close Button Accessibility And Confirm Audit

## 背景

Round 383 后的下一步优先级是补验主 IDE World Engine Workbench 的原生 `window.confirm` 取消分支，尤其是 Slice Composer 已有未保存草稿时，点击关闭后取消确认是否会保留 Composer 与草稿。

## 本轮目标

- 用真实 `ming-ding-zhi-shi-2` Project 打开主 IDE World Engine Workbench。
- 在 Slice Composer 中制造未保存草稿。
- 点击关闭入口并尝试 dismiss 原生 confirm。
- 如果发现用户入口本身不可定位，先补最小可访问性。

## 实际执行

- 启动 `bunx nuxt dev --port 3001`，打开 `http://localhost:3001/?project=workspace%2Fming-ding-zhi-shi-2`。
- 进入 World Engine Workbench 后，确认真实数据已同步：7 个 subject、4 条普通可见 slice，包含三条 `[验收]` 主线 slice。
- 发现两个纯图标关闭按钮缺少可访问名称：
  - Workbench 顶部关闭按钮无 `aria-label` / `title` / `data-testid`。
  - Slice Composer 浮层关闭按钮无 `aria-label` / `title` / `data-testid`。
- 补充：
  - `data-testid="world-workbench-close"`、`aria-label="关闭 World Engine Workbench"`、`title="关闭 World Engine Workbench"`。
  - `data-testid="world-slice-composer-close"`、`aria-label="关闭 Slice Composer"`、`title="关闭 Slice Composer"`。
- 重载页面后确认两个 test id 在真实 Workbench 中出现。
- 使用真实键盘输入在 Slice Composer 标题中追加 ` [验收草稿-取消关闭] Round 384`，页面出现 `当前有未保存草稿`，说明 child editor 的 dirty 状态已成立。
- 通过 in-app browser 自动化点击 `关闭 Slice Composer` 后，自动化通道没有暴露 `getJsDialog()` 可 dismiss 的 confirm；页面表现为继续关闭 Composer。因此本轮不能把它作为“用户取消分支通过”的证据。

## 变更文件

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - 为 Workbench 关闭按钮和 Slice Composer 关闭按钮补充可访问名称、title 与 test id。
- `app/utils/world-engine-ide-entry.test.ts`
  - 增加关闭按钮 test id / aria-label 静态契约断言。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - 1 file / 3 tests passed。
- 真实浏览器观察：
  - `world-workbench-close` 与 `world-slice-composer-close` 已出现在真实页面 DOM。
  - Slice Composer 中真实键盘输入后，页面出现 `当前有未保存草稿`。
  - in-app browser 自动化无法可靠证明原生 `window.confirm` 的取消分支：点击关闭后没有可读取的 JS dialog，动作继续关闭 Composer。

## 与计划出入

- 原计划：完成原生 `window.confirm` 取消分支浏览器验收。
- 实际结果：完成关闭入口可访问性修复和静态契约测试；确认 in-app browser 自动化通道仍不能可靠证明原生 confirm 取消分支。
- 因此 `window.confirm` 取消分支仍保留为人工可见浏览器补验项，或后续改为应用内确认 Dialog 后再自动化覆盖。

## 后续

- 不建议继续在 in-app browser 上反复抠原生 confirm；它已经两轮表现为无法可靠提供取消分支证据。
- 下一步更值得决策：
  - 保持 v1 `window.confirm`，由人工可见浏览器补验取消分支。
  - 或把 Workbench / Composer 草稿确认统一换成应用内 Dialog，使自动化和用户体验都可控。
