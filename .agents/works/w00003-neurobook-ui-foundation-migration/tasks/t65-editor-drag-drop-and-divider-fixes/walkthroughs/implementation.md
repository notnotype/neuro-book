# t65 实施记录：标签拖放泄漏、预览模糊、分界线一致性

日期：2026-09-19。worktree `.worktree/w00003-neurobook-ui-foundation-migration`。本轮不提交、不推远端、不碰 3001 与开发者真实数据根；浏览器验证走自建隔离服务（44777）与系统 Temp 状态根。

## 1. 排查过程与证据

### 1.1 drop 泄漏（反馈 2）

读码确认的链路：

1. `EditorTabBar.vue` 在 `dragstart` 里写 `text/plain` = `tab.path`、`application/x-editor-tab` = 路径、`application/x-editor-group` = 组 id，并置共享拖拽状态（`useEditorTabDrag`）。
2. `EditorGroup.vue`（修复前）把 `@dragenter/@dragover/@dragleave/@drop` 挂在正文容器上——**冒泡阶段**。
3. 真实视图在自己 DOM 上处理 drop：`MarkdownEditorView` → `TipTapMarkdownEditor`（ProseMirror，JS 插入并 `stopPropagation`）；`CodeEditorView` → Monaco（同理）；
   `<textarea>`/contenteditable 则走浏览器默认动作（把 `text/plain` 插进内容）。
4. 结果：容器处理器拿不到事件（拿到也已晚），标签路径进正文 → 正文变脏、可能被保存。

真实浏览器复现（修复前，隔离服务 44777，Lab 的 EditorWorkbench）：

```
drop 事件 target = TEXTAREA.min-h-0.flex-1
dataTransfer.getData('text/plain') = "src/story/chapter-02.md"
document 级冒泡日志：无（事件在视图处被消费）
```

补充事实：Lab 的 mock 视图是纯 `<textarea>`（`app/component-lab/fixtures/editor-workbench/mock-views.ts`），它不消费 drop，
所以**只有真实视图才会泄漏**——这也是此前 Lab 全绿却仍带病的原因。

### 1.2 预览模糊（反馈 3）

修复前实测 `getComputedStyle(overlay).backdropFilter === "blur(1.5px)"`，类名来源 `EditorGroup.vue` 的 `backdrop-blur-[1.5px]`。

### 1.3 分界线不一致（反馈 4）

Lab 四组（2×2）实测：

| 分界线 | 位置 | 厚度 | 背景 |
| --- | --- | --- | --- |
| 横线（左列） | y=560（整数） | 1px | `srgb 0.937 0.914 0.875 / 0.09` |
| 竖线（外层） | **x=679.5（半像素）** | 1px | 同上 |
| 横线（右列） | y=560 | 1px | 同上 |

同色同厚，差别只在栅格：容器 386px 分两栏 → 面板 192.5px → 竖线落在半像素上被抗锯齿摊成两条更淡的线。
交叉处两条横线各自止于竖线边缘（竖线覆盖 679.5–680.5），指针在交叉点只命中竖线。

## 2. 改动清单

| 文件 | 改动 |
| --- | --- |
| `packages/neuro-book/app/components/editor-workbench/EditorGroup.vue` | 拖拽期捕获层 `[data-role="editor-drop-layer"]`；落点判定与事件派发改成层上的一次实现（删掉计数式 dragenter/dragleave 与 `isHoveringTabBar` 分支）；`allowSplit` 门控；drop 后延一拍清拖拽状态；`pointerdown` 自愈；预览去掉 `backdrop-blur-[1.5px]` |
| `packages/neuro-book/app/components/editor-workbench/useEditorTabDrag.ts` | window 级 `dragend` 兜底（源标签被搬走时它自己的 dragend 没有冒泡路径） |
| `packages/nb-ui/src/components/layout/Splitter.vue` | 分界线像素对齐：粗细取整数设备像素、位置吸附到设备像素网格（`transform`，响应式 dpr，ResizeObserver + window resize + layout + sashSizes/direction 触发）；`data-[sash-cross=true]:bg-[var(--accent-main)]` 样式钩子 |
| `packages/nb-ui/src/components/layout/GridRenderer.vue` | 最外层实例协调交叉高亮：根元素 `pointermove` 委派、2px 容差命中判定、写 `data-sash-cross`；嵌套实例经 provide/inject 只消费标记 |
| `packages/nb-ui/src/components/layout/{Splitter,GridRenderer}.md`、`packages/neuro-book/app/components/editor-workbench/EditorWorkbench.md` | 合同与边界更新 |

用例：

- `splitter.test.ts` 新增 `describe("分界线像素对齐")` 2 例（半像素吸附 + 重复结算不回跳；dpr 1.25 上粗细 0.8px、位移 −0.3px）。
- `GridRenderer.test.ts` 新增 `describe("分界线交叉高亮")` 1 例（交叉处三条分界线都被标记、离开交叉点只剩竖线、离开分界线清空）。
- `EditorWorkbench.test.ts`：重写拖放用例（捕获层 + `allowSplit`），新增「未声明分屏能力时不给反馈也不发事件且仍吞掉 drop」（含"没有拖拽时同一位置的 drop 会正常冒泡到视图"对照），新增「捕获层只在拖拽期间存在 + window dragend 兜底」。

测试抓到的两个真实缺陷（都已修正，记录以免复发）：

1. drop 处理里先清拖拽状态再取载荷 → `transfer-tab` 的来源组丢失，且宿主（Lab 夹具）依据 `activeDraggedTab` 才把标签从源组**移动**到新组，同步清会让它退化成复制。现改为"先取载荷 → 派发事件 → 晚一拍清理"，并用用例钉死"宿主在 drop 处理里仍读得到来源"。
2. 半像素分界线吸附用例必须让 `getBoundingClientRect` 复现 transform 的影响，否则第二次结算会按旧位置重算，出现回跳假象；位移需量化到 1/10000 px 再写 CSS，否则 `-0.2999999999999545px` 这类浮点噪声进样式字符串。

早期踩到的测试坑（已修正）：

1. 吸附测试必须让 `getBoundingClientRect` 复现 transform 的影响，否则第二次结算会按旧位置重算，出现回跳假象。
2. 位移要量化到 1/10000 px 再写 CSS，否则 `-0.2999999999999545px` 这类浮点噪声进入样式字符串。

## 3. 验证结果

| 命令 / 场景 | 结果 |
| --- | --- |
| `bun run test`（packages/nb-ui，全量） | 23 文件 / **392 用例通过** |
| `bun run test app/components/editor-workbench ... app/component-lab app/composables/useEditorWorkbench.test.ts`（packages/neuro-book，聚焦全量） | 42 文件 / **380 用例通过** |
| `bun run typecheck`（packages/neuro-book） | exit 0 |
| `bun run build:css`（packages/nb-ui） | 完成，`dist/nb-ui.css` 新增 `data-[sash-cross=true]` 规则（diff 15 行新增 0 删除） |
| `bun run docs:check` / `bun run governance:check`（worktree 根） | 6111 文件 0 失败 / 0 失败 0 警告 |
| `bun run typecheck`（packages/nb-ui） | exit 0 |
| `bun run test src/components/layout`（packages/nb-ui） | 5 文件 / **106 用例通过** |
| `bun run test app/components/editor-workbench app/utils/editor-workbench`（packages/neuro-book） | 9 文件 / **58 用例通过** |
| `bun run test app/components/editor-workbench` | 7 文件 / **49 用例通过** |

真实浏览器（Lab → EditorWorkbench，隔离服务 44777）：

| 动作 | 修复前 | 修复后 |
| --- | --- | --- |
| 拖标签到正文中心并松手 | drop 落在 `TEXTAREA`，携带标签路径 | 捕获层存在、无预览、视图 dragover 0 次 / drop 0 次、textarea 值仍为 39 字符 |
| 拖标签到正文左缘 | 预览带 `blur(1.5px)`；drop 落在视图 | 预览显示「在左侧分屏」且 `backdrop-filter: none`；分屏成功 1 → 2 组；视图 drop 0 次 |
| 投放后 | — | 捕获层与预览都卸载（`layerGone`/`previewGone` 均为 true）；9 标签组拖 `chapter-02.md` 左缘分屏后为 `[1, 8]`、总数 9（标签被移动，宿主在 drop 处理里读得到来源） |
| 纵向分界线 | x=679.5（半像素，抗锯齿） | `transform: translateX(0.5px)`，实测 x=680（整数），厚度 1 设备像素 |
| 指针停在横竖交叉处 | 只有竖线高亮 | 三条分界线（竖线 + 左右横线）全部带 `data-sash-cross` |

未跑：主页端到端拖拽（隔离根中「新建书籍」静默失败，拿不到可打开文档）；nb-ui `test:e2e`（本轮未改 e2e 断言与 playground 场景，且其 webServer 在本 worktree 起不来的环境问题仍在）；`build:css`（无 class/token 增删，仅新增 `data-[sash-cross=true]:bg-[var(--accent-main)]` 这一条 Tailwind 变体，需按惯例确认）。

## 4. 与反馈 1 的关系

「产品多组未启用」指的是：主页仍是单组（`allowSplit` 未打开、页面未接 `split-tab`/`transfer-tab`、`editorGroupId` 固定 `main`、无编辑组布局记录与恢复）。
本轮修的是组件宿主的行为（拖放不许漏、预览与分界线必须一致），产品多组需要的三个切片（编辑组会话、页面多组接线、布局恢复）仍未做，也不在本轮隐含范围内。
