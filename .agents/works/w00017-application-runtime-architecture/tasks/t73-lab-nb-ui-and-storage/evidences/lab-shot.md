# nb-ui 组件的 lab:shot 扫描（t73 S2）

2026-10-10 在本 worktree 的开发会话上，对 75 个 nb-ui 组件的全部场景各拍四张：手机与 1400x900 两种画布，乘深浅两套配色，共 980 张。命令（每个组件一次）：

```bash
NB_LAB_URL=http://127.0.0.1:<开发端口> node scripts/lab-shot.ts -c <组件> --vp phone,1400x900 --cw dark,light --out <目录> --no-fail
```

截图在会话临时目录，不入库；这里只记结论。

## 第一轮发现与处理

| 发现 | 原因 | 处理 |
|---|---|---|
| ContextMenu、Dialog、Drawer 共 36 条 Vue 警告 | 根是传送门或片段，接不住透传的 `data-lab-subject` | Dialog、ContextMenu 的手写 fixture 不加标记；`defineSubjectFixture` 增加 `rootless`，Drawer 使用 |
| DateField、PinInput、TimeRangeField、Stepper 报横向溢出 | 视觉隐藏的输入框与 Stepper 的 `aria-live` 节点（透明度 0）被量进去，不是可见溢出 | 舞台测量跳过看不见的元素（透明度 0、`visibility: hidden`、`clip` 或 `clip-path` 裁成零）；`e2e/lab-shot.e2e.ts` 加了隐藏宽元素不报的断言 |
| Collapsible、CollapsibleSection 在手机画布溢出 6px | 内容区向外扩 6px，给焦点环留位置，是有意的取舍 | 不改；写进 `packages/nb-ui/src/components/layout/Collapsible.md` |

## 修正后重拍

上表涉及的 8 个组件重拍后：页面错误与控制台警告 0 条；溢出只剩 Collapsible、CollapsibleSection 的 4 张，即上表的有意取舍。
