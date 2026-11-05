---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: ui.backgrounds
owners:
  - nbook.workbench
  - nbook.editor
  - nbook.files
---

# 背景图片与护眼底色

## 目标与非目标

**目标**：写作者给正文区域或整个窗口换背景：一张自己的图片，或者（正文）一个护眼的纯色；换了以后文字仍然读得动。

**不承诺**：

- 按作品分别设置（设置是用户层，所有作品共用）。
- 书架页、设置窗口这些独立页面的背景；视频；模糊强度的调节。
- 动图：PNG、WebP 的动画不检测，会不会动由浏览器决定。
- 弱化文字（`--text-muted`）的对比度达到 4.5：它没有背景时也不到，这里只保证不比没有背景时差。
- 比值之外的可读性没有机检：图的纹理是否抢字由人眼走查，机检只保证对比度。

## 术语与参与者

- **背景**：现在有两种：**正文背景**（编辑组的内容区）与**窗口背景**（整个工作台窗口）。
- **遮罩**：盖在图片上的一层面色，`scrim` 是它的不透明度（百分比）。
- **下限**：这张面色能取的最小 `scrim`（输出 5）。
- 参与者：`nbook.workbench`（设置、窗口背景、设置页）、`nbook.editor`（正文背景）、`nbook.files`（存图片）。

## 输入与前置条件

两个设置项，都只在用户层（`layers: ["user"]`）：

```ts
type BackgroundImage = {
    kind: "image";
    image: string;                          // user://backgrounds/<64 位十六进制>.(png|jpg|webp)
    fit: "cover" | "contain" | "repeat";
    blur: boolean;                          // 选图时缺省 true
    scrim: number;                          // 75–100，选图时缺省 85
};

// nbook.workbench/background.editor，缺省 {kind: "none"}
type EditorBackground = {kind: "none"} | {kind: "color"; light: string; dark: string} | BackgroundImage;   // light、dark 是 #rrggbb

// nbook.workbench/background.window，缺省 {kind: "none"}
type WindowBackground = {kind: "none"} | BackgroundImage;
```

不符合的值（多余的字段、别处的地址、`scrim` 越界、窗口背景写 `color`）按配置的规则拒绝（[`settings.configuration`](../settings/configuration.md)）。

上传见 [`workspace.files`](../workspace/files.md) 的“写背景图片”。

## 输出与可观察行为

1. **正文背景的范围**：画在每个编辑组的内容区，标签条与面包屑之下，保持实心。Markdown 与源码编辑器透出；图片查看器、HTML 预览不透出。图按组定位，不随正文滚动；拆分、拖分隔条时按新尺寸重排。工具栏通栏时在背景上，并入面包屑时在实心行里，底部浮条有自己的面。
2. **窗口背景的范围**：铺满工作台窗口。标题栏、状态栏与各卡片（侧栏、编辑区、面板）是遮罩后的半透明面，卡片之间的缝直接露图。浮层（菜单、对话框）不受影响。
3. **两种同时开**：正文背景盖在窗口背景上面。
4. **填充与模糊**：`cover` 铺满裁边；`contain` 完整显示，留边露面色；`repeat` 平铺。`blur` 为真时图是模糊的。
5. **下限**：模糊时 75，不模糊时 92；再按当前配色算：主文字、次要文字、链接与高亮的正文对比度都不低于 4.5。模糊时按这张图模糊后最亮、最暗的地方算；不模糊时细节都在，按纯白与纯黑的最坏情况算；量不了这张图时也按最坏情况。实际下限取两者的较大值。设置里的 `scrim` 低于实际下限时按下限显示，设置不改写。
6. **切换明暗与主题**：下限与面色跟着重算；纯色底换成对应明暗的那一个。
7. **纯色底**：只有正文背景。亮、暗各给预设：亮色羊皮纸、豆沙绿；暗色深棕、墨绿。自定义颜色时主文字、次要文字与链接在它上面都要不低于 4.5，不合格不应用，设置页说明原因。
8. **无障碍偏好**：`prefers-reduced-transparency: reduce`、`prefers-contrast: more` 与 `forced-colors: active` 下不画图片，退回主题的实心面；设置不改写。
9. **设置页**：设置窗口左栏一项“背景”。两种背景各一块：无、纯色（只有正文）、图片；图片有上传、已传过的图、填充方式、模糊开关与遮罩滑块，滑块从实际下限开始，松手才写设置。预览和真实显示是同一套画法。除错误与状态外没有说明文字。

## 状态与转换

无持久状态之外的状态：显示由“设置 × 明暗 × 主题 × 无障碍偏好 × 图片能否加载”算出。

时序与寿命：

- 设置变了立即生效，所有窗口同步。
- 图片加载完成之前按没有背景显示，不闪别的图；换图时旧图留到新图加载好。
- 窗口背景只在工作台页面挂载期间生效，页面卸载（例如去 Lab）时撤掉。

## 副作用与数据

图片是 `user://backgrounds/` 下的文件，不随设置删除；设置只记引用。设置页列出已传过的图。

## 失败与恢复

| 情形 | 结果 |
|---|---|
| 图片不见或解码失败 | 记诊断，按没有背景显示，设置不改写；设置页显示原因；文件回来后下次加载恢复 |
| 上传失败 | 设置不改，设置页显示原因（超限、类型不支持、冲突） |
| 设置写入失败 | 设置页显示原因，显示保持原样 |

## 边界与兼容

- 公开接口：两个设置项；上传路由。字段只追加。
- 信任边界：设置里的地址只认 `user://backgrounds/`，不接受远程地址；图片显示经现有字节路由。

## 验收与 Smoke

1. Given 纯白、纯黑与高细节三张图，在 nbook、macos × 明暗下分别设为正文背景与窗口背景，遮罩取下限；When 隐藏文字量背景；Then 图确实画出来了（与无背景不同），正文、次要文字、链接、面包屑、标题栏、状态栏与侧栏的最差对比度都不低于 4.5，弱化文字不低于它无背景时的值。
2. Given 设了背景，When 模拟减少透明、提高对比度、强制颜色；Then 不画图片。
3. Given 上传一张图再选中，When 重启应用；Then 背景还在；When 删掉文件；Then 退回没有背景，设置页显示原因，文件放回后恢复。
4. Given 拆成两组，When 拖分隔条；Then 每组的图按新尺寸重排，正文滚动时图不动。

Smoke：`e2e/backgrounds.e2e.ts`。

## 实现合同

- 公开入口：`workbench/shared/contracts.ts`（`editorBackgroundSetting`、`windowBackgroundSetting`、`BACKGROUND_SECTION`）；`files/shared/contracts.ts`（`BACKGROUND_UPLOAD_URL`、`BACKGROUND_MAX_BYTES`、`BACKGROUND_DIRECTORY_ADDRESS`）。
- owner 与依赖方向：设置、窗口背景与设置页归 `nbook.workbench`，正文背景归 `nbook.editor`，都用 `src/ui/background/` 的画法与计算；图片字节归 `nbook.files`。
- 不变量：窗口背景把算好的字面量写在文档根，先移除自己写的变量再读主题的值，否则切明暗时读到自己的半透明值（`backgrounds.e2e.ts` 的“切明暗”）。不在子作用域覆盖 `--panel-surface`：派生变量已在根上算好，层数还会相乘。
- 不变量：写入不是乐观的，设置页的草稿留到写入回来，否则滑块先弹回旧值。

## 证据

- 批准依据：开发者 2026-11-05 的决定，记在主工作区 master 的 `.agents/works/w00025-editor/tasks/t19-background-image/README.md` 决定 1–4。
- 实现入口：[`src/ui/background/`](../../../packages/neuro-book/src/ui/background/use-background-image.ts)、[`WorkbenchShell.vue`](../../../packages/neuro-book/src/plugins/workbench/web/components/WorkbenchShell.vue)、[`EditorGroup.vue`](../../../packages/neuro-book/src/plugins/editor/web/components/EditorGroup.vue)、[`BackgroundSettingsPage.vue`](../../../packages/neuro-book/src/plugins/workbench/web/components/BackgroundSettingsPage.vue)、[`background-route.ts`](../../../packages/neuro-book/src/plugins/files/backend/background-route.ts)
- 合同测试：[`background-legibility.test.ts`](../../../packages/neuro-book/src/ui/background/background-legibility.test.ts)、[`background-route.test.ts`](../../../packages/neuro-book/src/plugins/files/background-route.test.ts)
- Smoke：[`backgrounds.e2e.ts`](../../../packages/neuro-book/e2e/backgrounds.e2e.ts)；量出来的对比度在 master 的 `.agents/works/w00025-editor/tasks/t19-background-image/evidences/contrast.txt`
