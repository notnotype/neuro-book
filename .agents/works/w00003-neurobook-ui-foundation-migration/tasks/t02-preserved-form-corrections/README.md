---
schema: nbook.task/v2
taskId: t02-preserved-form-corrections
---

# 保全表单控件修复

## 目标

闭合 `@notnotype/nb-ui` 公共表单的三个回归：checkbox 渐变 token 与键盘焦点环、native input 伪元素样式作用域、生成 CSS 的确定性。

## 允许改动

- `FormCheckbox.vue`：checked/indeterminate 渐变使用 `#000000`；visual span 恢复 `peer-focus-visible:border-[color:var(--focus-outline)] peer-focus-visible:shadow-[var(--focus-ring)]`，disabled 语义不变。
- `FormInput.vue` 的 prefix/suffix/裸 input 与 `PinInput.vue` 的 `PinInputInput` 增加 `nb-ui-native-input` marker；`src/styles.css` 的 search decoration 与 number spinner selector 只匹配该 marker。
- 相邻 component/CSS contract tests、playground fixtures、Chromium e2e 与 `docs/ui-development-spec.md` 同步可观察合同。
- 执行前已有 `SliderFixture.vue` 方案实现按开发者决定保全，不重写或回退；`dist/nb-ui.css` 仅由 `src/tailwind.css` 重建。

## 验证

1. 回归测试先证明旧 selector 会污染无 marker 宿主 input、checkbox 缺焦点环和 `black` token，再由源码修复转绿。
2. component tests 覆盖 marker、model、focus 与 PinInput number input；CSSOM 断言每个 search/number 伪元素 selector 都含 marker。
3. Chromium 在桌面与 390px 验证 checkbox Tab 焦点环、checked 背景、marker 控件伪元素抑制、无 marker 控件保持默认样式、无横向溢出及新增 console error/warning。
4. 连续运行两次 `bun run build:css`，第一次产物复制到系统 Temp，第二次与其字节及 SHA-256 完全相同后才暂存。

本 Task 不扩大 `nb-ui` 公共 API，不修改表单 disabled/model 合同，不发布包，不执行浏览器人工验收。
