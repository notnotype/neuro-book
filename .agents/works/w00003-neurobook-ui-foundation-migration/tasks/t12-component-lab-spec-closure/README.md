---
schema: nbook.task/v2
taskId: t12-component-lab-spec-closure
---

# 补全 Component Lab 当前规范

## 目标

把 `docs/specs/ui/component-lab.md` 从原型前的 planned 边界说明补全为与当前 Component Lab 实现一致的行为合同。只有正文、实现、测试和真实 smoke 证据一致后，才将同一 Spec 原地晋升为 `implemented`，并同步 `docs/specs/README.md` 的成熟度登记。

本 Task 只闭合 Component Lab 规范，不代表 `w00003` 整体完成，不实现 t09，不开始 C 产品主题 clean cutover，也不开始 E–O 组件迁移。

## 当前边界

- t09 已由开发者决定延期；其 `<800` 行硬验收仍未满足，延期记录位于 [`../t09-labshell-decomposition/README.md`](../t09-labshell-decomposition/README.md)。
- 组件 Lab 已有真实 `/lab` 入口、组件树、派生索引、场景选择、四个检视 tab、检查器、响应式容器、窄屏收起、reduced-motion、Lab 偏好持久化和生产排除证据。
- Lab 主题使用 nb-ui 是开发工具自身状态，不等于 C 的产品 `theme.system` clean cutover；本 Task 不修改产品主题 Spec。

## 允许改动

- `docs/specs/ui/component-lab.md`：补齐当前实现合同、实现合同和证据链接；原地将 `status: planned` 晋升为 `status: implemented`。
- `docs/specs/README.md`：把 `ui.component-lab` 从待实现规范移到已实现规范。
- 本 Task 的 walkthrough：记录依据、语义审查、机器检查、真实 smoke、未完成 Work 范围和延期边界。

不修改 Component Lab 业务代码、t09 实现、`docs/specs/theme/system.md`、C Task、远端 Issue/Project、PR、分支合并、发布或部署配置。

## 必须补齐的合同

1. 导航与选择：组件索引来自组件 Markdown 扫描；按组显示；公开 Tree 值为 string id；不可挂载项仍可查询并显示原因。
2. 检视面板：固定提供“文档、元素、事件、数据”四个 tab；元素检查支持 hover 探针、选中标签和复制定位报告。
3. 场景交互：组件有确定性 fixture 时提供场景选择；场景直接替换，不产生空白退场；数据面板提供重置；重复打开或重置保持初始输入和可观察状态一致。
4. 容器与响应式：随窗口、手机 `390 × 844`、平板 `768 × 1024`；运行中进入 `<=700px` 自动收起两侧栏，回宽屏不自动展开；侧栏转场和 reduced-motion 合同。
5. 偏好与数据边界：localStorage `nb-lab:preferences:v1`、IndexedDB 壁纸、字段白名单/校验/fail-open；不持久化 fixture、当前组件、场景、检查器、选择或事件日志；不接触产品数据。
6. 生产排除与失败：Lab 只在 Source Dev 构建图注册；Product 构建不得包含 Lab、fixture、开发绝对路径或识别标记；存储和 fixture 失败按现有 fail-open 或失败即拒绝边界处理。

## 实现合同与证据

Implemented Spec 至少链接：

- 实现入口：`packages/neuro-book/app/component-lab/`、`packages/neuro-book/app/pages/lab.vue`、`packages/neuro-book/scripts/smoke/component-lab.ts`。
- 组件索引：`component-index.ts` 及组件同名 Markdown。
- 合同测试：Lab 偏好 store/composable 测试、HighlightBox 测试、主应用 Component Lab 测试和 nb-ui Tree 回归测试。
- 真实 smoke：当前 revision 上实际执行的 NeuroBook `/lab` smoke 命令与结果。
- 生产排除：t05 最终 walkthrough 中的构建门禁证据；若当前 revision 缺少可引用的实际构建结果，必须标明未验证，不以静态阅读代替。

## 验证

- `bun run docs:check`
- `bun run governance:check`
- `git diff --check`
- 对照实现、测试和 walkthrough 逐章人工语义核对：目标、输入、输出、状态、副作用、失败、边界和验收无矛盾。
- 不重复执行真实浏览器人工验收；已有自动 smoke 证据必须保留命令、URL、结果和 revision。

## 完成门禁

- Spec 正文不再把已实现的 Lab 界面形态写成“尚未定义”。
- Spec `status: implemented`，索引成熟度同步正确。
- 实现合同、测试入口和 smoke 证据可由 Leader 独立恢复。
- t09 延期、C 未开始、渐进组件迁移未完成等 Work 边界明确记录。
- 未运行的生产构建、完整 nb-ui E2E 和人工视觉验收保持如实披露。

## 后续增量（2026-09-21 验证入口条款）

- 规范正文在「输入与前置条件」新增一类不可独立挂载的判据：组件文档 frontmatter 声明 `验证入口:` 的受控零件
  （props 全部来自宿主链，`state:inject` / `env:portal`）不可独立挂载，中栏给出原因与一条直达宿主场景的入口，
  Lab 不为它们另造宿主。「输出与可观察行为」「失败与恢复」「验收与 Smoke」第 3 条与「实现合同 · 索引边界」同步
  写入 `verifyEntry` 的派生与降级规则。
- [`组件规范`](../../../../../docs/standards/code/components.md) 的组件文档一节新增 frontmatter 可选键 `验证入口`，
  与既有 `别名` 并列，明确它不改写能力标签。
- 实现同步：`component-index.ts` 解析并派生；`LabShell.vue` 中栏入口与右栏文案；workbench 链 5 个零件文档声明该键；
  fixture 与场景迁移记录见 [t20 执行记录](../t20-workbench-shell-adoption/README.md)。
- 本轮证据：`app/component-lab` 13 文件 / 65 例通过；`/lab` 实测入口跳转与两个迁移场景；`docs:check` 与
  `governance:check` 均 `failures: []`。
