# AgentProfileNavList UX 引导性审查（hallmark audit）

- 日期：2026-09-07
- 审查对象：`packages/neuro-book/app/components/novel-ide/settings/views/agent-profile/AgentProfileNavList.vue`
- 审查方式：hallmark audit 反模式清单 + 真实浏览器测量（`http://127.0.0.1:3001/lab`，1440×900）
- 当前 HEAD：`071a9b2a`
- 结论：**Summary — 2 critical · 3 major · 4 minor**；引导性不足主要来自「可点击但看起来不可点击」（#1、#3）与「选中态唯一信号是颜色」（#2）。

## Critical

### 1. 默认设置入口与静态内容视觉无差别

- **Where**：`AgentProfileNavList.vue` L87-113（默认按钮）。
- **Tell**：按钮与普通文本行完全同构——无边框、无背景、无 affordance 提示（chevron/箭头），`cursor: default`。非激活态文字用 `text-[var(--text-secondary)]` + 灰色滑杆图标，与说明文字视觉权重相同。用户扫视时只能把它当成“分类标签”，而不是可点击入口。
- **Fix**：非激活态加 `cursor-pointer`；图标与文字提升一级（`text-main`）；右侧加 muted chevron（`i-lucide-chevron-right`）作为可点击暗示。

### 2. 选中态缺少持续的非颜色标记（合同已声明但实现退化）

- **Where**：`AgentProfileNavList.md` L23 合同 vs `.vue` 实现。
- **Tell**：合同要求“当前入口使用 `aria-current="page"`，并同时使用持续可见的非颜色选择标记”。当前实现只有整行 accent 背景——选中态唯一的区分信号是背景色变化（左线与前一轮 check 图标均被移除），对色弱用户不可用。
- **Fix**：选中项恢复一个不依赖颜色的持续标记——名称前小圆点、右侧 `i-lucide-circle-dot`，或恢复细左线（2px accent）。

## Major

### 3. 默认入口和 Profile 行的视觉层级倒置

- **Tell**：默认入口（所有 Profile 的继承基线，概念上的“父级”）渲染为 32px 高、更灰、更小的一行，看起来像次要工具链接；七个 56px 的 Profile 卡片反而像主内容。默认入口的使用频率不低于单个 Profile。
- **Fix**：把默认入口做成与 Profile 行同级的卡片（同高、同结构），或给它持久的 neutral surface 底色表示常驻入口。

### 4. info Tooltip 按钮点击目标过小

- **Where**：L102-105、L118。
- **Tell**：两个 info 按钮 16×16px，低于 WCAG 2.5.8 推荐的 24×24 最小点击目标；`aria-label` 有但视觉上与装饰图标无法区分。
- **Fix**：视觉图标保持 16px，热区扩到 24×24（padding 或负 margin）。

### 5. 状态图标与卡片可点击性语义混淆

- **Tell**：行尾彩色状态图标（✓/⚠/!）可能被当作 badge 延续，用户不知道整行可点；`cursor: default` 加剧了这一点。
- **Fix**：所有按钮统一 `cursor-pointer`；hover 时状态图标淡化（opacity-60）以突出“整行是一个交互目标”。

## Minor

### 6. `⌘` 符号无功能

- Header 右上角纯装饰，无 tooltip、无快捷键绑定。
- **Fix**：删除，或接真实快捷键 + tooltip。

### 7. `7/7` 计数器语义重复

- 分组标题已表达列表语义；`n/n` 只在搜索过滤时有意义。
- **Fix**：`search` 为空时隐藏，非空时显示。

### 8. 徽章轨道 280px 下可能溢出裁切

- 事实审校行 3 个徽章在 `overflow-hidden` 下会截掉第三个。
- **Fix**：超过 1 个时折叠为 `+N`，或降低徽章 padding。

### 9. 搜索框无可见 placeholder

- `sr-only` label + `FormInput` 未传 `placeholder`，空搜索框完全无提示。
- **Fix**：`:placeholder="t('settings.panels.profileModels.nav.searchPlaceholder')"`。

## 建议最小修复集（不动布局结构，全部在现有 token 体系内）

1. #1：cursor + chevron 提示
2. #2：非颜色选中标记
3. #9：placeholder
4. #4：info 按钮点击热区
