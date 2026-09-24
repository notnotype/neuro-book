---
标签: [state:local, env:portal, env:global]
---

# LucideIconPickerDialog

`LucideIconPickerDialog` 是从打包的 Lucide 图标清单中搜索并选择图标名的模态选择器。它把过滤词、当前选中高亮与选择后关闭组合在一起，向宿主返回规范图标名；不更新调用方的数据模型。

## 布局与交互

弹窗固定宽 640px，高度为 `min(720px, 82vh)`，上方是搜索框，下方是可滚动的图标网格。网格按图标名筛选，空搜索显示全部清单；每格呈现图标和名称，已选图标高亮。匹配为 trim 后、小写的子串包含匹配。空结果显示“没有匹配的图标”。

搜索框可输入过滤文本；点击图标发出 `select(name)`，随后请求关闭并发出 `update:modelValue(false)`。底层 nb-ui Dialog 提供关闭按钮、遮罩与 Escape 关闭请求，以及模态焦点管理；外部关闭通过受控 `modelValue` 通知宿主。

## 数据

```ts
interface LucideIconPickerDialogProps {
    /** 是否打开；必填、受控。 */
    modelValue: boolean;
    /** 当前选中图标；可省略或为 null，均无选中高亮。 */
    selectedIcon?: string | null;
}

interface LucideIconPickerDialogEmits {
    /** 内层 nb-ui Dialog 请求改变显隐时发出。 */
    (event: "update:modelValue", value: boolean): void;
    /** 点击图标后先发出，再发 update:modelValue(false)。 */
    (event: "select", value: string): void;
}
```

没有 slots 或 expose。组件把搜索框与图标网格作为底层 nb-ui Dialog 的默认 body，attrs 没有稳定的 DOM 透传目标。`selectedIcon` 通过 `normalizeLucideIconName` 接受原名、`i-lucide-` 前缀或 `lucide:` 前缀；无法识别的名称按未选中显示。可搜索列表来自当前打包的 `@iconify-json/lucide` 图标清单。

## 状态与边界

- `modelValue=false` 时关闭；`true` 时显示选择器。`modelValue` 必填。
- 搜索词是实例内状态，关闭再打开同一实例时保留；组件卸载后丢失。
- 已选图标高亮，但初始 prop 不会限制用户可选择的图标。
- 空结果显示空态；组件没有加载或错误状态。
- 不写入文件、偏好或 store，选择与后续保存完全由宿主完成。

## 上游边界

图标名称清单、排序、CSS class 及合法名称归 `nbook/app/utils/lucide-icons.ts`；搜索界面和回传时序由本组件承诺。模态语义、焦点、遮罩和关闭规则由 nb-ui `Dialog` 提供，具体 Teleport 与键盘实现随该组件变化。

## 隐藏通道理由

- `state:local`：持有搜索关键字并据此过滤图标，组件卸载后丢失。
- `env:portal`：内部 nb-ui Dialog 固定 Teleport 到 `.novel-ide-theme`，让浮层脱离裁剪并位于真实页面宿主内。Component Lab 页面自身提供此节点，所以可独立挂载；产品侧实际调用方是 `WorkspaceFileDetailPanel`。
- `env:global`：内部 nb-ui Dialog 打开后管理 document Escape 监听、body 滚动锁和焦点移入/归还；关闭或卸载时清理这些效果。它在挂载时会处理初始 `modelValue=true`，不适用 common Dialog 的首次打开偏差。