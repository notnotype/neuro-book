---
schema: nbook.task/v2
taskId: t09-labshell-decomposition
role: tasker
---

# 拆分超长 LabShell 外壳

## 背景

`t05` 产出的 `packages/neuro-book/app/component-lab/LabShell.vue` 当前为 1204 行，超过 `docs/standards/code/frontend.md` 规定的 Vue 单文件组件 800 行硬审查线。该问题是已知结构债务，不否定 t05 的功能与产物门禁结果，也不构成 t06 preview 清退的阻断。

## 目标

按稳定职责拆分 LabShell，使外壳保留页面编排与状态所有权，展示型面板、工具条或样式职责迁移到有明确边界的现有/新模块；不改变 Lab 的可观察行为、受控侧栏 API、fixture 合同、主题 token 或产物排除规则。

## 范围

- 先按模板区域、状态所有权和隐藏通道绘制拆分边界。
- 保持 Lab 的 header、左侧组件树、中间画布、右侧检视面板、检查器覆盖层行为一致。
- 每个新增组件按组件规范补齐同名文档和能力标签；整体页面外壳可继续由 `LabShell` 持有。
- 拆分后运行受影响 typecheck、Component Lab smoke、相关测试、docs check 和 diff check。

## 不做

不重构 `treeItems` 的单次 `Map` 分组，不为性能理由引入缓存或新抽象；不改变 t06 删除边界，不修改 nb-ui，不增加产品功能，不把人工视觉验收写成自动验证。

## 验收

1. `LabShell.vue` 小于 800 行，拆分后的职责边界可由文件结构和文档解释。
2. Lab 的桌面/窄屏、场景切换、侧栏收起、检查器和 reduced-motion 行为保持不变。
3. 受影响验证通过，walkthrough 记录实际变更、证据、未运行项和残余风险。


## 固定依据

- [`docs/standards/code/frontend.md`](../../../../../../docs/standards/code/frontend.md)
- [`docs/standards/code/components.md`](../../../../../../docs/standards/code/components.md)
- [`docs/specs/ui/component-lab.md`](../../../../../../docs/specs/ui/component-lab.md)
- t05 `LabShell` walkthrough
