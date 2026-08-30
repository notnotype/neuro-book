---
schema: nbook.walkthrough/v1
taskId: t04-nb-ui-adoption
sequence: 1
role: tasker
status: in-progress
createdAt: 2026-08-30T00:00:00Z
---

# t04 接入 nb-ui 与第一个消费者

## 已完成

在 `.worktree/w00003-neurobook-ui-foundation-migration`、分支 `refactor/w00003-nb-ui-adoption` 上执行。

- `packages/nb-ui` 许可证由 `PolyForm-Noncommercial-1.0.0` 改为 `AGPL-3.0-only`，`LICENSE` 替换为与仓库根一致的 AGPL 全文，`PROJECT-STATUS.md` 的许可证描述同步更新。
- `packages/neuro-book` 新增 `@notnotype/nb-ui` workspace 依赖，`bun install --linker hoisted` 更新 `bun.lock`（25 行新增、4 行删除）。
- `nuxt.config.ts` 在 reset 之后、领域样式之前加入 `@notnotype/nb-ui/styles.css`，并新增 `build.transpile`。未启用 nb-ui 的 Nuxt module。
- `JsonViewer.vue` 的三个动作按钮（复制、展开全部、折叠全部）切换到 nb-ui `IconButton`，尺寸 `sm` 对应原有 1.6rem；`.json-viewer__icon-button` 的全部样式已删除，文件内该类名出现次数为 0。
- 新增 `app/components/common/JsonViewer.md`，本仓库第一份组件文档。

## 已验证

- `bun --cwd packages/neuro-book run typecheck`：无输出，通过。执行前先运行 `bun run generate` 补上新 worktree 缺失的 Prisma client。
- `bun run docs:check`：`failures: []`。新增的组件同名文档没有触发文档结构检查。
- nb-ui 与主应用的 CSS 变量声明无同名冲突：nb-ui 声明 94 个（不含 `--tw-*`），主应用 `theme-vars.css` 声明 66 个，交集为 0。
- nb-ui 的 `dist/nb-ui.css` 中唯一的通配选择器是 Tailwind 的变量初始化块，只设置 `--tw-*`，不改变任何视觉属性；没有裸元素选择器重设现有元素样式。

## 未验证

- 浏览器行为、桌面与 `390×844` 视觉、六个按钮的实际点击结果与焦点环，均未运行。
- 没有覆盖 JsonViewer 工具栏的自动化测试。仓库内唯一引用该组件的测试文件不在 vitest 的 include 范围内，不构成回归防线。
- 产品构建未运行，样式在真实构建下的层叠顺序未验证。

## Nuxt 子目录 index.vue 命名探针

在 `novel-ide`（带前缀）与 `common`（免前缀）两个目录各放一对探针组件后运行 `nuxi prepare`，读取生成的 `.nuxt/components.d.ts`：

| 源文件 | 注册名 |
|---|---|
| `novel-ide/NamingProbe/index.vue` | `NovelIdeNamingProbe` |
| `novel-ide/NamingProbeFlat.vue` | `NovelIdeNamingProbeFlat` |
| `common/ProbeCommon/index.vue` | `ProbeCommon` |
| `common/ProbeCommonFlat.vue` | `ProbeCommonFlat` |

结论：`Foo/index.vue` 与 `Foo.vue` 得到完全相同的注册名，`index` 不进入组件名，免前缀目录同样成立。**组件目录化不会改变任何组件名，也不改变现有的同名碰撞情况。**探针已删除，仓库中不留该形态的组件。

## 发现一：模式按钮无法直接迁移

JsonViewer 的三个模式按钮是纯图标且有选中态。两个候选公共组件都覆盖不了这个形态：

- `IconButton` 有图标但没有选中状态，也不提供 `aria-pressed`。用 `variant` 的外观档位冒充状态会让辅助技术读不出当前选中项，属于把可访问性回退伪装成迁移。
- `SegmentedControl` 有完整的选中语义（`aria-pressed`、`aria-checked`、roving tabindex），但模板无条件渲染文字标签，没有纯图标模式。改用它会让工具栏出现「文本 树形 表格」三段文字，是可见的视觉变化。

按组件规范「公共入口覆盖不了现有行为时保持旧入口并报告缺口」，三个模式按钮保持原样未迁移，缺口在此登记。这与 t01 记录的停止条件一致，不用 adapter 或静默 fallback 绕过。

## 发现二：nb-ui 依赖宿主提供两个未定义变量

nb-ui 引用 106 个自定义属性。逐一比对后，`--overlay-bg` 与 `--shadow-panel` 既不由 `dist/nb-ui.css` 声明，也不在主应用 `theme-vars.css` 中，且在部分用法上没有兜底值。nb-ui 自己的 README 也把这两个列为需要宿主提供的变量。

本 Task 不受影响，`IconButton` 未使用它们。但迁移浮层与面板类组件（Dialog、Dropdown、Panel）时会得到空值，需要在对应切片前补齐宿主变量或为它们提供兜底。

## 发现三：组件文档的详略分档没有覆盖配方偏离

JsonViewer 的标签为 `state:local` 与 `env:clipboard`，不落在五种推荐配方内，属于档位 D 配方偏离。组件规范的详略分档表只写了纯零件、受控零件、领域视图、宿主与流式宿主，没有说配方偏离该写多少。

本次按「写出 Lab 演示不出来的部分」处理，完整写了六节。规范需要补一条对配方偏离的默认要求。
