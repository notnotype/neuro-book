---
标签: ["state:local"]
---

# 网络图

查看器的关系图、全书图“按关联”和人物卡小图共用的 Sigma（WebGL）网络图（docs/specs/story/viewer.md 输出 22 到 29、31）。点一样大、画成类型色的空心圆圈，线一样粗；一对点之间的几种联系合成一条直线，认知用箭头标方向；身份连接单独一种样式并写明“可能是同一人”“其实是同一人（不知道）”等。画法与交互沿用 w00024 t01 评审定下的草稿。

## 排版与取景

排版按画布的真实尺寸算（输出 25）：先把力导向、应力的外框拉成和画布（容器减去取景的边）一样的宽高比，再按“铺满时每个图坐标占几个像素”把每个点的圆圈加右边的名字当作矩形互相推开（推开会让外框变大，按新的比例再推，至多四轮）。关系图里强制出名字的点按权重挑，名字框合计不超过画布面积的三成：点少时名字全出，点多时只出主要的，其余的悬停、选中或放大后出。取景（首次显示、重新排版、点“铺满”、没动过镜头时容器变宽变窄）按外框的宽高比铺满画布，不再用 Sigma 默认把长边放进短边的镜头。

## 布局

铺满父容器。左下是图例（类别色与线的种类），右下是放大、缩小、铺满、全屏四个按钮；`compact` 时都不画。画布随容器大小变化重设尺寸并重画。

## 交互

- 滚轮缩放、拖动平移；点可以拖动，移动不到 4 像素不算拖动，拖动结束不算点选。
- 悬停或选中一个点：它的圈加粗、填淡色、外圈光晕；它与邻居照常、相连的线写全几种联系；其余点与线变淡但仍可见、线上的字去掉。`neighborhood` 时其余点隐藏、镜头框住这一圈。
- 点一个点发 `select`；点空白处取消选中。
- `query` 非空时命中的点高亮、镜头移到第一个。
- 切换 `layers` 或 `minCo`：只换线、按新的线重新排版，点从原位置平滑移动到新位置。换 `layout` 或 `relayoutKey` 加一：从固定起点重新排。
- `nodes`、`edges`、`dataEdges` 变了（往后挪阅读位置、勾选“只画最强的线”、新数据回来）：不重建 Sigma，原地改图。已有的点留在原位，新点放在已放好的邻居旁边，没有了的点和线直接去掉，然后和换层一样从当前位置接着排、点滑到新位置，新点新线在半秒内淡入（淡入时不写名字）。人物卡小图（`ego`）仍整张重画。挪章后的布局取决于挪动前的布局（含手动拖过的点、动画走到一半的点），同一章从头打开和一章章翻过去排出来的不一样，不能当固定的截图基线；要归位用“重新排版”。页面要配合：新数据回来之前不把组件卸掉（`useStoryQuery` 的 `keepOnForward`）。

## 数据

```ts
type NetworkNode = {id: string; label: string; kind: string; weight: number};
type NetworkEdge = {a: string; b: string; word: string | null; statements: number; together: number; ab: number; ba: number;
    identity: "uncertain" | "unaware" | "no-record" | "heard" | "believes" | "suspects" | null};
type DataEdge = {a: string; b: string; type: "participates" | "about" | "link" | "relation"; count: number};

defineProps<{
    nodes: NetworkNode[];                 // 必填；kind 决定颜色（对象类别，或 arc、episode、secret、question）
    mode: "relation" | "data";            // 必填
    edges?: NetworkEdge[];                // relation 的线，缺省 []
    dataEdges?: DataEdge[];               // data 的线，缺省 []
    layers?: string[];                    // relation 画哪几层：relation、co、know；缺省 ["relation", "co"]
    layout?: "force" | "concentric" | "circle"; // 缺省 "force"
    relayoutKey?: number;                 // 加一就从头排一次，缺省 0
    ego?: string | null;                  // 人物卡小图的中心；给了就只画他与关系最多的 12 个，缺省 null
    selected?: string | null;             // 受控的选中点，缺省 null
    // nodes 里每个点可带 names：这个点的其他称呼（别名），搜索 query 同时匹配显示名与它们
    neighborhood?: boolean;               // 只看选中的周边，缺省 false
    hiddenTypes?: string[];               // data 不画的点类型，缺省 []
    minCo?: number;                       // 同场门槛，缺省 2
    compact?: boolean;                    // 小图：点小、线上只写关系词、不画图例与按钮，缺省 false
    query?: string;                       // 图里搜名字，缺省 ""
    pinned?: string[];                    // 必出名字、名字加粗的点，缺省 []
}>();
defineEmits<{(event: "select", id: string): void}>();
```

`overlay` 插槽：页面放进来的浮层（选中浮条 `SelectionBar`）。它在图的根元素里，所以进入全屏后仍然看得到。

没有 slots、expose；attrs 透传到外层。

## 状态

- `state:local`：Sigma 实例、graphology 图、悬停与选中、拖动中的点、正在进行的移动动画。ResizeObserver 只观察自己的画布；全屏按钮只对自己的根元素调 `requestFullscreen`，不注册全局监听。

## 上游边界

点与线的绘制、相机、拾取与标签格子去重来自 Sigma 3 与 graphology；力导向来自 graphology-layout-forceatlas2。本组件承诺上面列出的交互与“同一数据、同一画布大小、同一排版结果相同”（排版前把完全重合的点按 id 错开，推开重叠没有随机数）。

## 注意事项

- Sigma 读不到 CSS 变量：挂载时从宿主元素取主题色转成十六进制；主题切换后要重新挂载才换色。
- 容器量出尺寸前不排版；父容器高度为 0 时什么也不画。
