# t38 Splitter 手势实现与证据

状态：实现与本 Task 最终消费者门禁、聚焦测试及真实浏览器验证完成，待 Leader 统一全包门禁。
基线：`70c7168d`（工作区 HEAD；本 Task 未提交）。
范围：`packages/nb-ui/src/components/layout/Splitter.vue`、同目录手势 helper/测试/文档、公开类型导出、
`SplitterFixture.vue`、`lab.css` 响应式测量台、聚焦 Playwright 用例、playground 宿主显式化及 `ui-development-spec.md` §4.2.12。
未编辑：`grid.ts`、`grid-geometry.ts`、grid 测试与主应用消费者（t37 owner）。

## 上游事实

- Reka 2.10 的 `SplitterGroup` 发布 `layout`，`SplitterResizeHandle` 的 `dragging` 只覆盖 mouse/touch 指针边界；键盘调整不发布手势。
- Reka 指针 registry 使用模块级 `isPointerDown`，只监听 `mousedown/mouseup/touch*`，不识别 `pointercancel`。本组件取消时补发上游认识的 `mouseup`；`touchcancel` 在捕获阶段先取消提交，再由 Reka 冒泡监听复位。
- 安装版 Reka 的 `Enter` 内建路径只 `setLayout()`，不发布 `layout`，也不更新 eager layout。组件拦截 `Enter`，改用 `SplitterPanel` 公开 `collapse/expand`，继续由 Reka 求解布局。
- Reka 相邻面板触界时会让更远兄弟吸收空间；helper 只比较 Reka 发布的 baseline/current layout，不实现第二套几何算法。

## 最终事件合同

- 保留 `layout`；新增 `gesture-start/update/end/cancel`。一次 pointer 操作或一次键盘连发只产生一次配对收口。
- `sizes` 是按 panel 顺序的百分比；`sash` 与字段身份使用宿主语义 id，仅在当前 Splitter 实例内解释。
- `active` 只包含 sash 两侧相对 baseline **实际改变**的 panel；触界未变化的相邻候选不进入 `active`。
  远端被动吸收空间的 panel 进入 `compensated`。宿主按 `active` 合成偏好，不能把整份 `sizes` 覆盖 Storage。
- Escape、pointercancel/touchcancel、指针窗口失焦、卸载、panel 身份/约束、sash 几何、方向及禁用变化取消，不产生保存意图；键盘窗口失焦正常结束。取消同时复位上游拖动态。
- panel DOM id 增加 Vue 实例命名空间，`aria-controls` 不再因主 grid/插件 grid 使用同名语义 id 而重复。
- `Enter` 折叠/恢复、方向键/Home/End、keyup、blur、空操作、禁用、嵌套/多实例和监听清理均由真实组件 + Reka 用例覆盖。
- 新增 `sashSizes?: readonly number[]`：按 panel 边界声明 sash 主轴实际像素，缺项 1px；零值不占布局、不命中指针且退出键盘/Tab，非法值诊断后回退 1px，尾项诊断后忽略。
- panel 约束和归一化 sash 几何按值变化取消手势；宿主只重建字段等值数组时不中断当前拖动。
- Panel ref 使用 Reka 导出的组件公开实例类型并在运行期窄化，不再使用 `as unknown as`。所有 `Enter` 在禁用守卫前截断 Reka 旧路径，按住期间只执行一次公开 collapse/expand。
- Lab responsive grid/canvas/window 设置 `min-width: 0` 和 `minmax(0, 1fr)`；fixture 长文案可收缩，390px 下被测 target 不再以 851px 假宽蒙混。

## 验证

工作目录均为当前 Work worktree 下的 `packages/nb-ui`。

1. `bun run vitest run src/components/layout/splitter-gesture.test.ts src/components/layout/splitter.test.ts`
   - 最终退出码 0：2 files passed，32 tests passed，1.94s。
   - 覆盖 pointercancel/touchcancel 上游收口、约束与 sash 几何的值变化取消、等值数组重建不中断、可取消键盘事件、Enter repeat 的 DOM/layout/提交一致性、禁用与零值边界、DOM 身份、嵌套实例及监听清理。
2. `NB_UI_E2E_PORT=3138 NB_UI_E2E_REUSE_SERVER=0 bun run test:e2e e2e/splitter.spec.ts --grep "禁用与零宽"`
   - 退出码 0：Chromium 1 passed，13.4s；确认禁用/零宽 Enter 不改几何，零宽 sash 不截获边界点击。
3. `NB_UI_E2E_PORT=3138 NB_UI_E2E_REUSE_SERVER=0 bun run test:e2e e2e/splitter.spec.ts`
   - 首次退出码 1：13 passed、1 failed；失败为隐藏 checkbox 被可见 label 拦截的测试辅助操作，错误原文 `locator.check: Test timeout of 60000ms exceeded`，已改为点击可见标签。
   - 最终退出码 0：Chromium 14 passed，24.7s。
   - 覆盖 7px/1px/0px 真实 sash CSS 几何、桌面拖动与提交、空操作、Enter repeat + Arrow 多键序列、禁用/零宽边界；nbook light/dark 与 macos light/dark 均在 desktop 和 `390×844` 形成 8 组合矩阵。
4. `bun run typecheck`
   - Splitter 第一轮修改后曾通过一次；按最终门禁要求未对本次收口重复运行全包 typecheck。
   - Leader 后续统一门禁需同时等待并行 t37 当前 `grid-geometry.ts` / `grid.ts` 类型错误收口；本 Task 不越界编辑。

## 未运行与交接

- 按最终门禁未运行 nb-ui 全包 test/typecheck/build。`lab.css` 已变化，Leader需重建 CSS 并执行连续两次确定性验证。
- 未接 WorkbenchBranch 或 Storage。后续宿主监听 `gesture-end`，以稳定 panel id 找到 `active` 字段并合成一次最终意图；`compensated` 只供诊断/几何解释。
- `ui.nested-grid` 仍为 `planned`；本 Task 只闭合 Splitter 原语，不单独晋升 capability。
