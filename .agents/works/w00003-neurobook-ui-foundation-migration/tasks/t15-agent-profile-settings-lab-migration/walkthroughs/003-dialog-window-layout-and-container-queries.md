# t15 Walkthrough 003 — DialogWindow 规格重构与 CSS Container Query 闭合

## 背景

开发者指出：
1. 删掉 `AgentProfileSettingsViewFixture.vue` 顶部的固定预览提示行（`仅供预览：修改只保留在本次场景，不写入真实配置。`）；
2. 明确指出该组件**后续是要放到 dialog window 中**的，因此原先横跨 1340px 的全宽顶部 `<header>`（包含大标题、作用域和保存按钮）显得怪异且与 DialogWindow 自带的窗口标题栏形成双重标题栏冲突。

## 重构与优化

### 1. 消除冗余顶栏，双栏从顶部自然铺展
- 彻底移除 `AgentProfileSettingsView.vue` 最外层的 `<header>` 元素；
- 避免组件嵌入 `DialogWindow` 时与窗口原生标题栏（Titlebar，含窗口标题、拖拽把手、关闭按钮）重叠冲突；
- 左侧 `AgentProfileNavList` 面板和右侧详情工作区面板直接从顶部平整展开。

### 2. 底部固定动作栏（Footer Action Bar）
- 依据标准弹窗/浮动窗口规格，将操作栏下沉到组件底部：`<footer class="flex shrink-0 ... border-t border-[var(--divider)] ...">`；
- **左侧状态感知**：
  - 作用域徽标：`<Badge tone="neutral" size="sm" variant="soft">{{ scopeLabel }}</Badge>`（「全局设定」或「项目设定: xxx」）；
  - 脏状态提示：仅在有未保存修改时浮现 `<Badge tone="warning">有未保存的修改</Badge>`，修改保存或放弃后自动消失；
  - 错误与保存中提示：就地在底部左侧紧凑展示，不再于主体上方横插破坏双栏布局的通知行。
- **右侧动作按钮**：
  - 「放弃修改」：无脏数据时置灰禁用（`:disabled="busy || !hasDirty"`），避免误操作并清晰反馈状态；
  - 「保存修改」：有有效修改且校验通过时高亮激活，点击保存后更新内存基线。

### 3. 严格遵循计划：CSS Container Queries (`@container`) 与双向焦点流转
- 闭合此前文档记录的“按浏览器视口而非组件容器断点”的已知偏差；
- 根元素声明 `container-type: inline-size;`；
- 通过 `@container (max-width: 699px)` 监听**组件自身容器宽度**：
  - 容器宽度 `<700px` 时（例如在 Lab 390px 手机画布、手机视口或窄尺寸 DialogWindow 内），自动进入单列移动端模式；
  - 详情工作区顶部提供「选择 Profile」按钮，点击呼出全宽导航并将焦点精准转移给导航顶部的「返回详情」按钮；
  - 展开的移动导航顶部提供「返回详情」按钮，点击关闭导航并将焦点精准归还给「选择 Profile」按钮；
  - 在导航列表中点选任意 Profile 项时，自动折叠导航并聚焦详情标题（`tabindex="-1"`），焦点流转完全闭合；
  - 容器宽度 `≥700px` 时，自动恢复标准桌面双栏，移动端切换条完全隐藏。

### 4. 清理 Fixture 顶部横条与弹性自适应高度
- 删除了 `AgentProfileSettingsViewFixture.vue` 顶部的灰色预览提示条；
- 调整 fixture 容器高度为 `h-full min-h-[560px] max-h-full w-full` 弹性自适应，不再硬编码固定高度导致不同视口截断或多余滚动。

### 5. 同步规范（Spec）条款
- 同步更新 `docs/specs/ui/agent-profile-settings.md`：
  - 将输出与可观察行为更新为无内置全宽顶栏、底部固定动作栏（DialogWindow 规格）；
  - 明确 CSS Container Query 容器断点响应与移动端双向焦点归还；
  - 在实现合同中明确组件入口、拆分架构、数据流与测试命令。

## 验证事实

1. **真实浏览器实测**：
   - 宽屏（1440px 窗口）：无任何顶部全宽 Header，左侧导航与右侧详情从顶部自然铺满，底部动作条完整可见，左侧徽标、右侧按钮（放弃修改置灰、保存修改置灰）；
   - 修改参数后：底部左侧实时亮起「有未保存的修改」Badge，右侧两按钮同时解锁；点击保存后提示出现、Badge 消失、按钮重新置灰；
   - 容器宽度响应与焦点流转（在 1440px 浏览器窗口中，把 Lab 画布切换到 390px 手机模式）：
     - `step1`：单列详情可见（`sec: flex, aside: none`），「选择 Profile」按钮存在；
     - `step2`：点击「选择 Profile」打开导航（`aside: block`），`activeElement` 精准聚焦「返回详情」按钮；
     - `step3`：点击「返回详情」关闭导航（`sec: flex`），`activeElement` 精准归还「选择 Profile」按钮；
     - `step4`：重新打开点选 `story-writer`，页面载入该 Profile，`activeElement` 精准聚焦详情标题（`tabindex="-1"`）；
2. `vue-tsc --noEmit`：0 错误；
3. 聚焦测试：5 文件 / 23 测试全通；
4. `bun run docs:check`：5405 文件 0 失败；
5. `bun run governance:check`：0 失败；
6. `git diff --check`：通过；
7. `packages/neuro-book/eval-tmp.ts` 严格保留未动。
