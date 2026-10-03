# Files 现状耗时基线

生成时间：2026-10-03T06:58:30.855Z；HEAD：a7346d225d48b8496078001a5ddfa656da85e827；生产镜像身份详见 JSON build.image。

完整运行：通过；有效样本 27/27。桌面版未测。

## A. 打开项目

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold | 1 | 815.80 | 815.80 | 815.80 | 815.80 |
| production/A/reopen | 1 | 606.40 | 606.40 | 606.40 | 606.40 |

服务冷开每次重启自有 Product；reopen 在同进程内关闭并再次打开。两者都会经历真实 Project Session 生命周期，OS 页缓存保持自然状态。

## B. 展开宽目录

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/B/notes-wide | 1 | 277.50 | 277.50 | 277.50 | 277.50 |

目录 notes/wide/ 直接包含 10 项。终点包括所有直接子行挂载与展开动画完成。最长完整 Long Task：

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/B/notes-wide | 1 | 0.00 | 0.00 | 0.00 | 0.00 |

当前服务发布完整 tree；B 是已收到快照的客户端展开，不新增按需目录协议。请求数见 JSON，不把零 tree 请求解释为已实现按需扫描。

## C. 点击至正文可编辑

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/C/cold-rich-1-group-tree | 1 | 372.70 | 372.70 | 372.70 | 372.70 |
| production/C/hot-rich-1-group-tree | 1 | 241.80 | 241.80 | 241.80 | 241.80 |
| production/C/hot-rich-1-group-tab | 1 | 55.30 | 55.30 | 55.30 | 55.30 |
| production/C/cold-rich-2-group-tree | 1 | 287.20 | 287.20 | 287.20 | 287.20 |
| production/C/hot-rich-2-group-tree | 1 | 252.20 | 252.20 | 252.20 | 252.20 |
| production/C/hot-rich-2-group-tab | 1 | 57.40 | 57.40 | 57.40 | 57.40 |
| production/C/cold-source-1-group-tree | 1 | 488.90 | 488.90 | 488.90 | 488.90 |
| production/C/hot-source-1-group-tree | 1 | 269.60 | 269.60 | 269.60 | 269.60 |
| production/C/hot-source-1-group-tab | 1 | 71.70 | 71.70 | 71.70 | 71.70 |
| production/C/cold-source-2-group-tree | 1 | 322.40 | 322.40 | 322.40 | 322.40 |
| production/C/hot-source-2-group-tree | 1 | 271.10 | 271.10 | 271.10 | 271.10 |
| production/C/hot-source-2-group-tab | 1 | 79.00 | 79.00 | 79.00 | 79.00 |
| development/C/cold-rich-1-group-tree | 1 | 560.60 | 560.60 | 560.60 | 560.60 |
| development/C/hot-rich-1-group-tree | 1 | 246.50 | 246.50 | 246.50 | 246.50 |
| development/C/hot-rich-1-group-tab | 1 | 56.50 | 56.50 | 56.50 | 56.50 |
| development/C/cold-rich-2-group-tree | 1 | 300.80 | 300.80 | 300.80 | 300.80 |
| development/C/hot-rich-2-group-tree | 1 | 253.70 | 253.70 | 253.70 | 253.70 |
| development/C/hot-rich-2-group-tab | 1 | 60.30 | 60.30 | 60.30 | 60.30 |
| development/C/cold-source-1-group-tree | 1 | 545.90 | 545.90 | 545.90 | 545.90 |
| development/C/hot-source-1-group-tree | 1 | 269.00 | 269.00 | 269.00 | 269.00 |
| development/C/hot-source-1-group-tab | 1 | 84.10 | 84.10 | 84.10 | 84.10 |
| development/C/cold-source-2-group-tree | 1 | 332.90 | 332.90 | 332.90 | 332.90 |
| development/C/hot-source-2-group-tree | 1 | 270.20 | 270.20 | 270.20 | 270.20 |
| development/C/hot-source-2-group-tab | 1 | 85.20 | 85.20 | 85.20 | 85.20 |

cold 是项目内首次打开的不同文件。hot-tree 从文件树单击两个已保留标签的文件；hot-tab 从标签按钮切换。富文本／源码、单组／双组独立记录，预热与 profiling 不进入常规统计。

冷开 read 次数：p50=1.0，p95=1.0；stat 与 read 每次计数见下表。

### 文件请求次数（单位：次）

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/C/cold-rich-1-group-tree/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-rich-1-group-tree/read | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/hot-rich-1-group-tree/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tree/read | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tab/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tab/read | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-rich-2-group-tree/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-rich-2-group-tree/read | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/hot-rich-2-group-tree/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tree/read | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tab/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tab/read | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-source-1-group-tree/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-source-1-group-tree/read | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/hot-source-1-group-tree/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tree/read | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tab/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tab/read | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-source-2-group-tree/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-source-2-group-tree/read | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/hot-source-2-group-tree/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tree/read | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tab/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tab/read | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-rich-1-group-tree/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-rich-1-group-tree/read | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/hot-rich-1-group-tree/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-1-group-tree/read | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-1-group-tab/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-1-group-tab/read | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-rich-2-group-tree/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-rich-2-group-tree/read | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/hot-rich-2-group-tree/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-2-group-tree/read | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-2-group-tab/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-2-group-tab/read | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-source-1-group-tree/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-source-1-group-tree/read | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/hot-source-1-group-tree/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-1-group-tree/read | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-1-group-tab/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-1-group-tab/read | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-source-2-group-tree/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-source-2-group-tree/read | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/hot-source-2-group-tree/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-2-group-tree/read | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-2-group-tab/stat | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-2-group-tab/read | 1 | 0.00 | 0.00 | 0.00 | 0.00 |

### 选中与标签反馈

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/C/cold-rich-1-group-tree/selectionMs | 1 | 3.80 | 3.80 | 3.80 | 3.80 |
| production/C/cold-rich-1-group-tree/tabMs | 1 | 275.50 | 275.50 | 275.50 | 275.50 |
| production/C/hot-rich-1-group-tree/selectionMs | 1 | 5.40 | 5.40 | 5.40 | 5.40 |
| production/C/hot-rich-1-group-tree/tabMs | 1 | 235.50 | 235.50 | 235.50 | 235.50 |
| production/C/hot-rich-1-group-tab/selectionMs | 1 | 48.90 | 48.90 | 48.90 | 48.90 |
| production/C/hot-rich-1-group-tab/tabMs | 1 | 48.90 | 48.90 | 48.90 | 48.90 |
| production/C/cold-rich-2-group-tree/selectionMs | 1 | 2.10 | 2.10 | 2.10 | 2.10 |
| production/C/cold-rich-2-group-tree/tabMs | 1 | 263.80 | 263.80 | 263.80 | 263.80 |
| production/C/hot-rich-2-group-tree/selectionMs | 1 | 4.70 | 4.70 | 4.70 | 4.70 |
| production/C/hot-rich-2-group-tree/tabMs | 1 | 245.90 | 245.90 | 245.90 | 245.90 |
| production/C/hot-rich-2-group-tab/selectionMs | 1 | 51.70 | 51.70 | 51.70 | 51.70 |
| production/C/hot-rich-2-group-tab/tabMs | 1 | 51.70 | 51.70 | 51.70 | 51.70 |
| production/C/cold-source-1-group-tree/selectionMs | 1 | 3.20 | 3.20 | 3.20 | 3.20 |
| production/C/cold-source-1-group-tree/tabMs | 1 | 286.70 | 286.70 | 286.70 | 286.70 |
| production/C/hot-source-1-group-tree/selectionMs | 1 | 2.80 | 2.80 | 2.80 | 2.80 |
| production/C/hot-source-1-group-tree/tabMs | 1 | 239.10 | 239.10 | 239.10 | 239.10 |
| production/C/hot-source-1-group-tab/selectionMs | 1 | 51.50 | 51.50 | 51.50 | 51.50 |
| production/C/hot-source-1-group-tab/tabMs | 1 | 51.50 | 51.50 | 51.50 | 51.50 |
| production/C/cold-source-2-group-tree/selectionMs | 1 | 5.30 | 5.30 | 5.30 | 5.30 |
| production/C/cold-source-2-group-tree/tabMs | 1 | 281.80 | 281.80 | 281.80 | 281.80 |
| production/C/hot-source-2-group-tree/selectionMs | 1 | 4.50 | 4.50 | 4.50 | 4.50 |
| production/C/hot-source-2-group-tree/tabMs | 1 | 239.60 | 239.60 | 239.60 | 239.60 |
| production/C/hot-source-2-group-tab/selectionMs | 1 | 54.60 | 54.60 | 54.60 | 54.60 |
| production/C/hot-source-2-group-tab/tabMs | 1 | 54.60 | 54.60 | 54.60 | 54.60 |
| development/C/cold-rich-1-group-tree/selectionMs | 1 | 9.10 | 9.10 | 9.10 | 9.10 |
| development/C/cold-rich-1-group-tree/tabMs | 1 | 378.00 | 378.00 | 378.00 | 378.00 |
| development/C/hot-rich-1-group-tree/selectionMs | 1 | 5.10 | 5.10 | 5.10 | 5.10 |
| development/C/hot-rich-1-group-tree/tabMs | 1 | 238.40 | 238.40 | 238.40 | 238.40 |
| development/C/hot-rich-1-group-tab/selectionMs | 1 | 50.40 | 50.40 | 50.40 | 50.40 |
| development/C/hot-rich-1-group-tab/tabMs | 1 | 50.40 | 50.40 | 50.40 | 50.40 |
| development/C/cold-rich-2-group-tree/selectionMs | 1 | 2.30 | 2.30 | 2.30 | 2.30 |
| development/C/cold-rich-2-group-tree/tabMs | 1 | 276.90 | 276.90 | 276.90 | 276.90 |
| development/C/hot-rich-2-group-tree/selectionMs | 1 | 4.40 | 4.40 | 4.40 | 4.40 |
| development/C/hot-rich-2-group-tree/tabMs | 1 | 245.40 | 245.40 | 245.40 | 245.40 |
| development/C/hot-rich-2-group-tab/selectionMs | 1 | 53.50 | 53.50 | 53.50 | 53.50 |
| development/C/hot-rich-2-group-tab/tabMs | 1 | 53.50 | 53.50 | 53.50 | 53.50 |
| development/C/cold-source-1-group-tree/selectionMs | 1 | 3.50 | 3.50 | 3.50 | 3.50 |
| development/C/cold-source-1-group-tree/tabMs | 1 | 257.90 | 257.90 | 257.90 | 257.90 |
| development/C/hot-source-1-group-tree/selectionMs | 1 | 2.70 | 2.70 | 2.70 | 2.70 |
| development/C/hot-source-1-group-tree/tabMs | 1 | 243.80 | 243.80 | 243.80 | 243.80 |
| development/C/hot-source-1-group-tab/selectionMs | 1 | 61.90 | 61.90 | 61.90 | 61.90 |
| development/C/hot-source-1-group-tab/tabMs | 1 | 61.90 | 61.90 | 61.90 | 61.90 |
| development/C/cold-source-2-group-tree/selectionMs | 1 | 3.10 | 3.10 | 3.10 | 3.10 |
| development/C/cold-source-2-group-tree/tabMs | 1 | 294.20 | 294.20 | 294.20 | 294.20 |
| development/C/hot-source-2-group-tree/selectionMs | 1 | 2.70 | 2.70 | 2.70 | 2.70 |
| development/C/hot-source-2-group-tree/tabMs | 1 | 247.50 | 247.50 | 247.50 | 247.50 |
| development/C/hot-source-2-group-tab/selectionMs | 1 | 64.40 | 64.40 | 64.40 | 64.40 |
| development/C/hot-source-2-group-tab/tabMs | 1 | 64.40 | 64.40 | 64.40 | 64.40 |

### 互斥关键路径区间

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/C/cold-rich-1-group-tree/clickToActivation | 1 | 181.40 | 181.40 | 181.40 | 181.40 |
| production/C/cold-rich-1-group-tree/activationToReadEnd | 1 | 16.80 | 16.80 | 16.80 | 16.80 |
| production/C/cold-rich-1-group-tree/readEndToSession | 1 | 8.90 | 8.90 | 8.90 | 8.90 |
| production/C/cold-rich-1-group-tree/sessionToView | 1 | 125.20 | 125.20 | 125.20 | 125.20 |
| production/C/cold-rich-1-group-tree/viewToEditable | 1 | 40.40 | 40.40 | 40.40 | 40.40 |
| production/C/hot-rich-1-group-tree/clickToActivation | 1 | 180.40 | 180.40 | 180.40 | 180.40 |
| production/C/hot-rich-1-group-tree/activationToReadEnd | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tree/readEndToSession | 1 | 0.30 | 0.30 | 0.30 | 0.30 |
| production/C/hot-rich-1-group-tree/sessionToView | 1 | 24.30 | 24.30 | 24.30 | 24.30 |
| production/C/hot-rich-1-group-tree/viewToEditable | 1 | 36.80 | 36.80 | 36.80 | 36.80 |
| production/C/hot-rich-1-group-tab/clickToActivation | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| production/C/hot-rich-1-group-tab/activationToReadEnd | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tab/readEndToSession | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| production/C/hot-rich-1-group-tab/sessionToView | 1 | 16.50 | 16.50 | 16.50 | 16.50 |
| production/C/hot-rich-1-group-tab/viewToEditable | 1 | 38.60 | 38.60 | 38.60 | 38.60 |
| production/C/cold-rich-2-group-tree/clickToActivation | 1 | 180.50 | 180.50 | 180.50 | 180.50 |
| production/C/cold-rich-2-group-tree/activationToReadEnd | 1 | 17.00 | 17.00 | 17.00 | 17.00 |
| production/C/cold-rich-2-group-tree/readEndToSession | 1 | 16.00 | 16.00 | 16.00 | 16.00 |
| production/C/cold-rich-2-group-tree/sessionToView | 1 | 54.70 | 54.70 | 54.70 | 54.70 |
| production/C/cold-rich-2-group-tree/viewToEditable | 1 | 19.00 | 19.00 | 19.00 | 19.00 |
| production/C/hot-rich-2-group-tree/clickToActivation | 1 | 180.50 | 180.50 | 180.50 | 180.50 |
| production/C/hot-rich-2-group-tree/activationToReadEnd | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tree/readEndToSession | 1 | 0.40 | 0.40 | 0.40 | 0.40 |
| production/C/hot-rich-2-group-tree/sessionToView | 1 | 29.60 | 29.60 | 29.60 | 29.60 |
| production/C/hot-rich-2-group-tree/viewToEditable | 1 | 41.70 | 41.70 | 41.70 | 41.70 |
| production/C/hot-rich-2-group-tab/clickToActivation | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| production/C/hot-rich-2-group-tab/activationToReadEnd | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tab/readEndToSession | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| production/C/hot-rich-2-group-tab/sessionToView | 1 | 17.10 | 17.10 | 17.10 | 17.10 |
| production/C/hot-rich-2-group-tab/viewToEditable | 1 | 40.10 | 40.10 | 40.10 | 40.10 |
| production/C/cold-source-1-group-tree/clickToActivation | 1 | 181.40 | 181.40 | 181.40 | 181.40 |
| production/C/cold-source-1-group-tree/activationToReadEnd | 1 | 33.00 | 33.00 | 33.00 | 33.00 |
| production/C/cold-source-1-group-tree/readEndToSession | 1 | 1.50 | 1.50 | 1.50 | 1.50 |
| production/C/cold-source-1-group-tree/sessionToView | 1 | 207.00 | 207.00 | 207.00 | 207.00 |
| production/C/cold-source-1-group-tree/viewToEditable | 1 | 66.00 | 66.00 | 66.00 | 66.00 |
| production/C/hot-source-1-group-tree/clickToActivation | 1 | 180.40 | 180.40 | 180.40 | 180.40 |
| production/C/hot-source-1-group-tree/activationToReadEnd | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tree/readEndToSession | 1 | 0.30 | 0.30 | 0.30 | 0.30 |
| production/C/hot-source-1-group-tree/sessionToView | 1 | 22.80 | 22.80 | 22.80 | 22.80 |
| production/C/hot-source-1-group-tree/viewToEditable | 1 | 66.10 | 66.10 | 66.10 | 66.10 |
| production/C/hot-source-1-group-tab/clickToActivation | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| production/C/hot-source-1-group-tab/activationToReadEnd | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tab/readEndToSession | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tab/sessionToView | 1 | 15.40 | 15.40 | 15.40 | 15.40 |
| production/C/hot-source-1-group-tab/viewToEditable | 1 | 56.10 | 56.10 | 56.10 | 56.10 |
| production/C/cold-source-2-group-tree/clickToActivation | 1 | 180.40 | 180.40 | 180.40 | 180.40 |
| production/C/cold-source-2-group-tree/activationToReadEnd | 1 | 14.50 | 14.50 | 14.50 | 14.50 |
| production/C/cold-source-2-group-tree/readEndToSession | 1 | 17.80 | 17.80 | 17.80 | 17.80 |
| production/C/cold-source-2-group-tree/sessionToView | 1 | 59.30 | 59.30 | 59.30 | 59.30 |
| production/C/cold-source-2-group-tree/viewToEditable | 1 | 50.40 | 50.40 | 50.40 | 50.40 |
| production/C/hot-source-2-group-tree/clickToActivation | 1 | 180.40 | 180.40 | 180.40 | 180.40 |
| production/C/hot-source-2-group-tree/activationToReadEnd | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tree/readEndToSession | 1 | 0.30 | 0.30 | 0.30 | 0.30 |
| production/C/hot-source-2-group-tree/sessionToView | 1 | 20.50 | 20.50 | 20.50 | 20.50 |
| production/C/hot-source-2-group-tree/viewToEditable | 1 | 69.90 | 69.90 | 69.90 | 69.90 |
| production/C/hot-source-2-group-tab/clickToActivation | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| production/C/hot-source-2-group-tab/activationToReadEnd | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tab/readEndToSession | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| production/C/hot-source-2-group-tab/sessionToView | 1 | 16.30 | 16.30 | 16.30 | 16.30 |
| production/C/hot-source-2-group-tab/viewToEditable | 1 | 62.40 | 62.40 | 62.40 | 62.40 |
| development/C/cold-rich-1-group-tree/clickToActivation | 1 | 180.90 | 180.90 | 180.90 | 180.90 |
| development/C/cold-rich-1-group-tree/activationToReadEnd | 1 | 107.70 | 107.70 | 107.70 | 107.70 |
| development/C/cold-rich-1-group-tree/readEndToSession | 1 | 1.80 | 1.80 | 1.80 | 1.80 |
| development/C/cold-rich-1-group-tree/sessionToView | 1 | 224.60 | 224.60 | 224.60 | 224.60 |
| development/C/cold-rich-1-group-tree/viewToEditable | 1 | 45.60 | 45.60 | 45.60 | 45.60 |
| development/C/hot-rich-1-group-tree/clickToActivation | 1 | 180.60 | 180.60 | 180.60 | 180.60 |
| development/C/hot-rich-1-group-tree/activationToReadEnd | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-1-group-tree/readEndToSession | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| development/C/hot-rich-1-group-tree/sessionToView | 1 | 24.50 | 24.50 | 24.50 | 24.50 |
| development/C/hot-rich-1-group-tree/viewToEditable | 1 | 41.20 | 41.20 | 41.20 | 41.20 |
| development/C/hot-rich-1-group-tab/clickToActivation | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| development/C/hot-rich-1-group-tab/activationToReadEnd | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-1-group-tab/readEndToSession | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| development/C/hot-rich-1-group-tab/sessionToView | 1 | 17.20 | 17.20 | 17.20 | 17.20 |
| development/C/hot-rich-1-group-tab/viewToEditable | 1 | 39.10 | 39.10 | 39.10 | 39.10 |
| development/C/cold-rich-2-group-tree/clickToActivation | 1 | 180.40 | 180.40 | 180.40 | 180.40 |
| development/C/cold-rich-2-group-tree/activationToReadEnd | 1 | 17.90 | 17.90 | 17.90 | 17.90 |
| development/C/cold-rich-2-group-tree/readEndToSession | 1 | 17.20 | 17.20 | 17.20 | 17.20 |
| development/C/cold-rich-2-group-tree/sessionToView | 1 | 65.00 | 65.00 | 65.00 | 65.00 |
| development/C/cold-rich-2-group-tree/viewToEditable | 1 | 20.30 | 20.30 | 20.30 | 20.30 |
| development/C/hot-rich-2-group-tree/clickToActivation | 1 | 180.60 | 180.60 | 180.60 | 180.60 |
| development/C/hot-rich-2-group-tree/activationToReadEnd | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-2-group-tree/readEndToSession | 1 | 0.30 | 0.30 | 0.30 | 0.30 |
| development/C/hot-rich-2-group-tree/sessionToView | 1 | 24.30 | 24.30 | 24.30 | 24.30 |
| development/C/hot-rich-2-group-tree/viewToEditable | 1 | 48.50 | 48.50 | 48.50 | 48.50 |
| development/C/hot-rich-2-group-tab/clickToActivation | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| development/C/hot-rich-2-group-tab/activationToReadEnd | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-2-group-tab/readEndToSession | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| development/C/hot-rich-2-group-tab/sessionToView | 1 | 17.50 | 17.50 | 17.50 | 17.50 |
| development/C/hot-rich-2-group-tab/viewToEditable | 1 | 42.60 | 42.60 | 42.60 | 42.60 |
| development/C/cold-source-1-group-tree/clickToActivation | 1 | 180.50 | 180.50 | 180.50 | 180.50 |
| development/C/cold-source-1-group-tree/activationToReadEnd | 1 | 15.00 | 15.00 | 15.00 | 15.00 |
| development/C/cold-source-1-group-tree/readEndToSession | 1 | 12.50 | 12.50 | 12.50 | 12.50 |
| development/C/cold-source-1-group-tree/sessionToView | 1 | 254.60 | 254.60 | 254.60 | 254.60 |
| development/C/cold-source-1-group-tree/viewToEditable | 1 | 83.30 | 83.30 | 83.30 | 83.30 |
| development/C/hot-source-1-group-tree/clickToActivation | 1 | 180.30 | 180.30 | 180.30 | 180.30 |
| development/C/hot-source-1-group-tree/activationToReadEnd | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-1-group-tree/readEndToSession | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| development/C/hot-source-1-group-tree/sessionToView | 1 | 23.50 | 23.50 | 23.50 | 23.50 |
| development/C/hot-source-1-group-tree/viewToEditable | 1 | 65.00 | 65.00 | 65.00 | 65.00 |
| development/C/hot-source-1-group-tab/clickToActivation | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| development/C/hot-source-1-group-tab/activationToReadEnd | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-1-group-tab/readEndToSession | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| development/C/hot-source-1-group-tab/sessionToView | 1 | 19.00 | 19.00 | 19.00 | 19.00 |
| development/C/hot-source-1-group-tab/viewToEditable | 1 | 64.80 | 64.80 | 64.80 | 64.80 |
| development/C/cold-source-2-group-tree/clickToActivation | 1 | 180.40 | 180.40 | 180.40 | 180.40 |
| development/C/cold-source-2-group-tree/activationToReadEnd | 1 | 20.30 | 20.30 | 20.30 | 20.30 |
| development/C/cold-source-2-group-tree/readEndToSession | 1 | 18.40 | 18.40 | 18.40 | 18.40 |
| development/C/cold-source-2-group-tree/sessionToView | 1 | 63.40 | 63.40 | 63.40 | 63.40 |
| development/C/cold-source-2-group-tree/viewToEditable | 1 | 50.40 | 50.40 | 50.40 | 50.40 |
| development/C/hot-source-2-group-tree/clickToActivation | 1 | 180.30 | 180.30 | 180.30 | 180.30 |
| development/C/hot-source-2-group-tree/activationToReadEnd | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-2-group-tree/readEndToSession | 1 | 0.30 | 0.30 | 0.30 | 0.30 |
| development/C/hot-source-2-group-tree/sessionToView | 1 | 23.10 | 23.10 | 23.10 | 23.10 |
| development/C/hot-source-2-group-tree/viewToEditable | 1 | 66.50 | 66.50 | 66.50 | 66.50 |
| development/C/hot-source-2-group-tab/clickToActivation | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| development/C/hot-source-2-group-tab/activationToReadEnd | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-2-group-tab/readEndToSession | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| development/C/hot-source-2-group-tab/sessionToView | 1 | 18.60 | 18.60 | 18.60 | 18.60 |
| development/C/hot-source-2-group-tab/viewToEditable | 1 | 66.40 | 66.40 | 66.40 | 66.40 |

这些区间按时间线单调切分，相加等于该操作总耗时。无 read 的 hot 样本不虚构网络阶段。控件与解析 measure 是嵌套子阶段，不能再次相加。

## D. 约 0.3 秒延迟

生产已出现 250–400 ms 操作，共 6 个；对应原始 C 样本 ID 保存在 reproduction.sampleIds，未复制样本充当新测量。

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| 生产 250–400 ms 样本 | 6 | 279.15 | 360.12 | 252.20 | 372.70 |

代表样本：production-C-cold-rich-1-group-tree-0。

| 区间 | 耗时 ms |
|---|---:|
| 点击至 activation（含单击等待） | 181.40 |
| activation 至 read 响应末尾 | 16.80 |
| 响应末尾至 session 发布 | 8.90 |
| session 至 view 发布 | 125.20 |
| view 发布至可编辑并跨帧确认 | 40.40 |

开发模式对照：完整完成，与生产使用同一参数、不同合成项目；结果在 C 表中。

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| 开发 250–400 ms 样本 | 5 | 270.20 | 326.48 | 253.70 | 332.90 |

开发代表样本：development-C-cold-rich-2-group-tree-0。

| 区间 | 耗时 ms |
|---|---:|
| 点击至 activation（含单击等待） | 180.40 |
| activation 至 read 响应末尾 | 17.90 |
| 响应末尾至 session 发布 | 17.20 |
| session 至 view 发布 | 65.00 |
| view 发布至可编辑并跨帧确认 | 20.30 |

## 与 t16、t24 的可比性

t16/t24 在 Windows、Chromium 151.0.7922.34、Source Dev、1440×1000 下测两个 8 KiB permanent 标签，3×30 次；t24 富文本单组 p50/p95=33.5/38.0 ms，源码单组=43.5/53.8 ms。本轮是 Linux、headless Chrome、生产构建、约 3000 个 5–30 KiB 文件，每格 30 次，输入证明逐样本进行。视口和 capture-click 起点相同，但构建、平台、文件大小、工程规模与跨帧终点不同，不能直接计算回归幅度。

仅 hot-tab 的入口与历史标签切换对应；hot-tree 保留既有 180 ms 单击等待，不与 t24 标签值直接比较。双组 hot-tab 也保留为补充，本轮要求的单组富文本／源码两格均有独立样本。

## 网络与阶段分解

### 每次操作请求总数（单位：次）

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold | 1 | 31.00 | 31.00 | 31.00 | 31.00 |
| production/A/reopen | 1 | 35.00 | 35.00 | 35.00 | 35.00 |
| production/B/notes-wide | 1 | 3.00 | 3.00 | 3.00 | 3.00 |
| production/C/cold-rich-1-group-tree | 1 | 6.00 | 6.00 | 6.00 | 6.00 |
| production/C/hot-rich-1-group-tree | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/hot-rich-1-group-tab | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/cold-rich-2-group-tree | 1 | 2.00 | 2.00 | 2.00 | 2.00 |
| production/C/hot-rich-2-group-tree | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/hot-rich-2-group-tab | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/cold-source-1-group-tree | 1 | 9.00 | 9.00 | 9.00 | 9.00 |
| production/C/hot-source-1-group-tree | 1 | 3.00 | 3.00 | 3.00 | 3.00 |
| production/C/hot-source-1-group-tab | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/cold-source-2-group-tree | 1 | 8.00 | 8.00 | 8.00 | 8.00 |
| production/C/hot-source-2-group-tree | 1 | 2.00 | 2.00 | 2.00 | 2.00 |
| production/C/hot-source-2-group-tab | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/cold-rich-1-group-tree | 1 | 8.00 | 8.00 | 8.00 | 8.00 |
| development/C/hot-rich-1-group-tree | 1 | 3.00 | 3.00 | 3.00 | 3.00 |
| development/C/hot-rich-1-group-tab | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/cold-rich-2-group-tree | 1 | 2.00 | 2.00 | 2.00 | 2.00 |
| development/C/hot-rich-2-group-tree | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-2-group-tab | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/cold-source-1-group-tree | 1 | 3.00 | 3.00 | 3.00 | 3.00 |
| development/C/hot-source-1-group-tree | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/hot-source-1-group-tab | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/cold-source-2-group-tree | 1 | 3.00 | 3.00 | 3.00 | 3.00 |
| development/C/hot-source-2-group-tree | 1 | 2.00 | 2.00 | 2.00 | 2.00 |
| development/C/hot-source-2-group-tab | 1 | 1.00 | 1.00 | 1.00 | 1.00 |

### 每个请求耗时

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 1 | 9.60 | 9.60 | 9.60 | 9.60 |
| production/A/service-cold//api/config/bootstrap | 3 | 12.60 | 24.57 | 11.00 | 25.90 |
| production/A/service-cold//api/projects/open | 1 | 95.80 | 95.80 | 95.80 | 95.80 |
| production/A/service-cold//api/storage/user/context | 4 | 32.85 | 38.17 | 26.80 | 38.20 |
| production/A/service-cold//favicon.ico | 1 | 23.80 | 23.80 | 23.80 | 23.80 |
| production/A/service-cold//api/projects | 1 | 17.80 | 17.80 | 17.80 | 17.80 |
| production/A/service-cold//api/workspace-files/tree | 1 | 510.10 | 510.10 | 510.10 | 510.10 |
| production/A/service-cold//api/storage/project/context | 2 | 57.60 | 58.32 | 56.80 | 58.40 |
| production/A/service-cold//api/storage/user/action | 8 | 49.25 | 80.99 | 36.00 | 83.20 |
| production/A/service-cold//api/storage/project/action | 9 | 44.10 | 70.52 | 18.70 | 72.20 |
| production/A/reopen//api/storage/user/action | 13 | 30.30 | 54.98 | 10.70 | 77.30 |
| production/A/reopen//api/auth/me | 1 | 14.60 | 14.60 | 14.60 | 14.60 |
| production/A/reopen//api/config/bootstrap | 3 | 11.70 | 20.07 | 9.10 | 21.00 |
| production/A/reopen//api/projects/open | 1 | 89.20 | 89.20 | 89.20 | 89.20 |
| production/A/reopen//api/storage/user/context | 4 | 27.30 | 33.78 | 23.50 | 34.50 |
| production/A/reopen//favicon.ico | 1 | 13.20 | 13.20 | 13.20 | 13.20 |
| production/A/reopen//api/projects | 1 | 9.70 | 9.70 | 9.70 | 9.70 |
| production/A/reopen//api/workspace-files/tree | 1 | 263.80 | 263.80 | 263.80 | 263.80 |
| production/A/reopen//api/storage/project/context | 2 | 29.40 | 30.03 | 28.70 | 30.10 |
| production/A/reopen//api/storage/project/action | 8 | 24.05 | 28.39 | 14.20 | 29.40 |
| production/B/notes-wide//api/storage/user/action | 2 | 9.00 | 10.26 | 7.60 | 10.40 |
| production/B/notes-wide//api/storage/project/action | 1 | 17.10 | 17.10 | 17.10 | 17.10 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 1 | 18.00 | 18.00 | 18.00 | 18.00 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 1 | 15.20 | 15.20 | 15.20 | 15.20 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 16.70 | 16.70 | 16.70 | 16.70 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 16.00 | 16.00 | 16.00 | 16.00 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 2 | 14.80 | 18.58 | 10.60 | 19.00 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 1 | 17.10 | 17.10 | 17.10 | 17.10 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 1 | 12.40 | 12.40 | 12.40 | 12.40 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 1 | 16.30 | 16.30 | 16.30 | 16.30 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 1 | 12.30 | 12.30 | 12.30 | 12.30 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 1 | 13.10 | 13.10 | 13.10 | 13.10 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 1 | 13.40 | 13.40 | 13.40 | 13.40 |
| production/C/cold-source-1-group-tree//api/storage/user/action | 2 | 46.40 | 47.30 | 45.40 | 47.40 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 4 | 20.30 | 41.30 | 19.40 | 45.00 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 1 | 31.90 | 31.90 | 31.90 | 31.90 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 5.50 | 5.50 | 5.50 | 5.50 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 5.40 | 5.40 | 5.40 | 5.40 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 3 | 13.20 | 14.37 | 7.90 | 14.50 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 1 | 12.00 | 12.00 | 12.00 | 12.00 |
| production/C/cold-source-2-group-tree//api/storage/user/action | 2 | 28.45 | 29.04 | 27.80 | 29.10 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 5 | 12.20 | 26.42 | 8.20 | 26.60 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 1 | 13.80 | 13.80 | 13.80 | 13.80 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 2 | 10.15 | 12.09 | 8.00 | 12.30 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 1 | 12.10 | 12.10 | 12.10 | 12.10 |
| development/C/cold-rich-1-group-tree//api/storage/user/action | 3 | 24.10 | 91.06 | 15.50 | 98.50 |
| development/C/cold-rich-1-group-tree//api/workspace-files/read | 1 | 106.90 | 106.90 | 106.90 | 106.90 |
| development/C/cold-rich-1-group-tree//_nuxt/components/editor-workbench/MarkdownEditorView.vue | 2 | 58.15 | 65.40 | 50.10 | 66.20 |
| development/C/cold-rich-1-group-tree//_nuxt/components/markdown-studio/MarkdownCommentFlowPanel.vue | 1 | 50.00 | 50.00 | 50.00 | 50.00 |
| development/C/cold-rich-1-group-tree//_nuxt/composables/useMarkdownEditorController.ts | 1 | 53.40 | 53.40 | 53.40 | 53.40 |
| development/C/hot-rich-1-group-tree//api/storage/user/action | 2 | 21.05 | 22.27 | 19.70 | 22.40 |
| development/C/hot-rich-1-group-tree//api/storage/project/action | 1 | 15.60 | 15.60 | 15.60 | 15.60 |
| development/C/hot-rich-1-group-tab//api/storage/project/action | 1 | 17.30 | 17.30 | 17.30 | 17.30 |
| development/C/cold-rich-2-group-tree//api/workspace-files/read | 1 | 17.10 | 17.10 | 17.10 | 17.10 |
| development/C/cold-rich-2-group-tree//api/storage/project/action | 1 | 14.40 | 14.40 | 14.40 | 14.40 |
| development/C/hot-rich-2-group-tab//api/storage/project/action | 1 | 15.80 | 15.80 | 15.80 | 15.80 |
| development/C/cold-source-1-group-tree//api/workspace-files/read | 1 | 14.50 | 14.50 | 14.50 | 14.50 |
| development/C/cold-source-1-group-tree//api/storage/user/action | 1 | 9.50 | 9.50 | 9.50 | 9.50 |
| development/C/cold-source-1-group-tree//_nuxt/components/editor-workbench/CodeEditorView.vue | 1 | 35.10 | 35.10 | 35.10 | 35.10 |
| development/C/hot-source-1-group-tree//api/storage/project/action | 1 | 14.50 | 14.50 | 14.50 | 14.50 |
| development/C/hot-source-1-group-tab//api/storage/project/action | 1 | 14.50 | 14.50 | 14.50 | 14.50 |
| development/C/cold-source-2-group-tree//api/workspace-files/read | 1 | 19.60 | 19.60 | 19.60 | 19.60 |
| development/C/cold-source-2-group-tree//api/storage/project/action | 2 | 13.60 | 15.49 | 11.50 | 15.70 |
| development/C/hot-source-2-group-tree//api/storage/project/action | 2 | 12.00 | 15.06 | 8.60 | 15.40 |
| development/C/hot-source-2-group-tab//api/storage/project/action | 1 | 14.70 | 14.70 | 14.70 | 14.70 |

### 每个请求响应体大小（单位：bytes，encodedBodySize）

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 1 | 113.00 | 113.00 | 113.00 | 113.00 |
| production/A/service-cold//api/config/bootstrap | 3 | 302.00 | 302.00 | 301.00 | 302.00 |
| production/A/service-cold//api/projects/open | 1 | 275.00 | 275.00 | 275.00 | 275.00 |
| production/A/service-cold//api/storage/user/context | 4 | 48.50 | 80.00 | 17.00 | 80.00 |
| production/A/service-cold//favicon.ico | 1 | 78.00 | 78.00 | 78.00 | 78.00 |
| production/A/service-cold//api/projects | 1 | 210.00 | 210.00 | 210.00 | 210.00 |
| production/A/service-cold//api/workspace-files/tree | 1 | 123806.00 | 123806.00 | 123806.00 | 123806.00 |
| production/A/service-cold//api/storage/project/context | 2 | 80.00 | 80.00 | 80.00 | 80.00 |
| production/A/service-cold//api/storage/user/action | 8 | 98.00 | 98.00 | 48.00 | 98.00 |
| production/A/service-cold//api/storage/project/action | 9 | 98.00 | 101.60 | 48.00 | 104.00 |
| production/A/reopen//api/storage/user/action | 13 | 98.00 | 98.00 | 48.00 | 98.00 |
| production/A/reopen//api/auth/me | 1 | 113.00 | 113.00 | 113.00 | 113.00 |
| production/A/reopen//api/config/bootstrap | 3 | 302.00 | 302.00 | 301.00 | 302.00 |
| production/A/reopen//api/projects/open | 1 | 275.00 | 275.00 | 275.00 | 275.00 |
| production/A/reopen//api/storage/user/context | 4 | 48.50 | 80.00 | 17.00 | 80.00 |
| production/A/reopen//favicon.ico | 1 | 78.00 | 78.00 | 78.00 | 78.00 |
| production/A/reopen//api/projects | 1 | 210.00 | 210.00 | 210.00 | 210.00 |
| production/A/reopen//api/workspace-files/tree | 1 | 123806.00 | 123806.00 | 123806.00 | 123806.00 |
| production/A/reopen//api/storage/project/context | 2 | 80.00 | 80.00 | 80.00 | 80.00 |
| production/A/reopen//api/storage/project/action | 8 | 98.00 | 343.00 | 48.00 | 343.00 |
| production/B/notes-wide//api/storage/user/action | 2 | 147.50 | 186.65 | 104.00 | 191.00 |
| production/B/notes-wide//api/storage/project/action | 1 | 98.00 | 98.00 | 98.00 | 98.00 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 1 | 191.00 | 191.00 | 191.00 | 191.00 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 1 | 5365.00 | 5365.00 | 5365.00 | 5365.00 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 9845.00 | 9845.00 | 9845.00 | 9845.00 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 184.00 | 184.00 | 184.00 | 184.00 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 2 | 275.00 | 428.90 | 104.00 | 446.00 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 1 | 104.00 | 104.00 | 104.00 | 104.00 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 1 | 104.00 | 104.00 | 104.00 | 104.00 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 1 | 5365.00 | 5365.00 | 5365.00 | 5365.00 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 1 | 104.00 | 104.00 | 104.00 | 104.00 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 1 | 104.00 | 104.00 | 104.00 | 104.00 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 1 | 104.00 | 104.00 | 104.00 | 104.00 |
| production/C/cold-source-1-group-tree//api/storage/user/action | 2 | 144.50 | 186.35 | 98.00 | 191.00 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 4 | 101.00 | 307.15 | 98.00 | 343.00 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 1 | 5366.00 | 5366.00 | 5366.00 | 5366.00 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 2210.00 | 2210.00 | 2210.00 | 2210.00 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 3650.00 | 3650.00 | 3650.00 | 3650.00 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 3 | 529.00 | 529.00 | 104.00 | 529.00 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 1 | 104.00 | 104.00 | 104.00 | 104.00 |
| production/C/cold-source-2-group-tree//api/storage/user/action | 2 | 144.50 | 186.35 | 98.00 | 191.00 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 5 | 98.00 | 826.40 | 98.00 | 1007.00 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 1 | 5366.00 | 5366.00 | 5366.00 | 5366.00 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 2 | 597.00 | 1040.70 | 104.00 | 1090.00 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 1 | 104.00 | 104.00 | 104.00 | 104.00 |
| development/C/cold-rich-1-group-tree//api/storage/user/action | 3 | 143.00 | 271.70 | 143.00 | 286.00 |
| development/C/cold-rich-1-group-tree//api/workspace-files/read | 1 | 5391.00 | 5391.00 | 5391.00 | 5391.00 |
| development/C/cold-rich-1-group-tree//_nuxt/components/editor-workbench/MarkdownEditorView.vue | 2 | 18423.50 | 23666.45 | 12598.00 | 24249.00 |
| development/C/cold-rich-1-group-tree//_nuxt/components/markdown-studio/MarkdownCommentFlowPanel.vue | 1 | 25826.00 | 25826.00 | 25826.00 | 25826.00 |
| development/C/cold-rich-1-group-tree//_nuxt/composables/useMarkdownEditorController.ts | 1 | 4205.00 | 4205.00 | 4205.00 | 4205.00 |
| development/C/hot-rich-1-group-tree//api/storage/user/action | 2 | 143.00 | 143.00 | 143.00 | 143.00 |
| development/C/hot-rich-1-group-tree//api/storage/project/action | 1 | 128.00 | 128.00 | 128.00 | 128.00 |
| development/C/hot-rich-1-group-tab//api/storage/project/action | 1 | 128.00 | 128.00 | 128.00 | 128.00 |
| development/C/cold-rich-2-group-tree//api/workspace-files/read | 1 | 5391.00 | 5391.00 | 5391.00 | 5391.00 |
| development/C/cold-rich-2-group-tree//api/storage/project/action | 1 | 128.00 | 128.00 | 128.00 | 128.00 |
| development/C/hot-rich-2-group-tab//api/storage/project/action | 1 | 128.00 | 128.00 | 128.00 | 128.00 |
| development/C/cold-source-1-group-tree//api/workspace-files/read | 1 | 5393.00 | 5393.00 | 5393.00 | 5393.00 |
| development/C/cold-source-1-group-tree//api/storage/user/action | 1 | 286.00 | 286.00 | 286.00 | 286.00 |
| development/C/cold-source-1-group-tree//_nuxt/components/editor-workbench/CodeEditorView.vue | 1 | 16435.00 | 16435.00 | 16435.00 | 16435.00 |
| development/C/hot-source-1-group-tree//api/storage/project/action | 1 | 128.00 | 128.00 | 128.00 | 128.00 |
| development/C/hot-source-1-group-tab//api/storage/project/action | 1 | 128.00 | 128.00 | 128.00 | 128.00 |
| development/C/cold-source-2-group-tree//api/workspace-files/read | 1 | 5393.00 | 5393.00 | 5393.00 | 5393.00 |
| development/C/cold-source-2-group-tree//api/storage/project/action | 2 | 1122.00 | 2016.60 | 128.00 | 2116.00 |
| development/C/hot-source-2-group-tree//api/storage/project/action | 2 | 1208.50 | 2180.95 | 128.00 | 2289.00 |
| development/C/hot-source-2-group-tab//api/storage/project/action | 1 | 128.00 | 128.00 | 128.00 | 128.00 |

### 首字节等待（服务执行与排队均在此内）

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 1 | 8.10 | 8.10 | 8.10 | 8.10 |
| production/A/service-cold//api/config/bootstrap | 3 | 9.90 | 22.77 | 9.30 | 24.20 |
| production/A/service-cold//api/projects/open | 1 | 94.20 | 94.20 | 94.20 | 94.20 |
| production/A/service-cold//api/storage/user/context | 4 | 31.20 | 36.57 | 25.60 | 36.60 |
| production/A/service-cold//favicon.ico | 1 | 22.30 | 22.30 | 22.30 | 22.30 |
| production/A/service-cold//api/projects | 1 | 15.90 | 15.90 | 15.90 | 15.90 |
| production/A/service-cold//api/workspace-files/tree | 1 | 508.10 | 508.10 | 508.10 | 508.10 |
| production/A/service-cold//api/storage/project/context | 2 | 55.15 | 56.01 | 54.20 | 56.10 |
| production/A/service-cold//api/storage/user/action | 8 | 45.20 | 47.33 | 34.50 | 47.50 |
| production/A/service-cold//api/storage/project/action | 9 | 40.80 | 63.08 | 17.10 | 65.60 |
| production/A/reopen//api/storage/user/action | 13 | 28.10 | 51.04 | 8.70 | 72.40 |
| production/A/reopen//api/auth/me | 1 | 13.20 | 13.20 | 13.20 | 13.20 |
| production/A/reopen//api/config/bootstrap | 3 | 10.20 | 18.66 | 7.60 | 19.60 |
| production/A/reopen//api/projects/open | 1 | 87.50 | 87.50 | 87.50 | 87.50 |
| production/A/reopen//api/storage/user/context | 4 | 25.65 | 32.34 | 21.30 | 33.10 |
| production/A/reopen//favicon.ico | 1 | 11.50 | 11.50 | 11.50 | 11.50 |
| production/A/reopen//api/projects | 1 | 8.00 | 8.00 | 8.00 | 8.00 |
| production/A/reopen//api/workspace-files/tree | 1 | 262.10 | 262.10 | 262.10 | 262.10 |
| production/A/reopen//api/storage/project/context | 2 | 25.55 | 26.77 | 24.20 | 26.90 |
| production/A/reopen//api/storage/project/action | 8 | 22.55 | 26.56 | 12.40 | 28.10 |
| production/B/notes-wide//api/storage/user/action | 2 | 7.70 | 8.87 | 6.40 | 9.00 |
| production/B/notes-wide//api/storage/project/action | 1 | 15.30 | 15.30 | 15.30 | 15.30 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 1 | 15.50 | 15.50 | 15.50 | 15.50 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 1 | 13.30 | 13.30 | 13.30 | 13.30 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 14.40 | 14.40 | 14.40 | 14.40 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 14.70 | 14.70 | 14.70 | 14.70 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 2 | 13.15 | 17.15 | 8.70 | 17.60 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 1 | 15.80 | 15.80 | 15.80 | 15.80 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 1 | 11.30 | 11.30 | 11.30 | 11.30 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 1 | 14.40 | 14.40 | 14.40 | 14.40 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 1 | 10.90 | 10.90 | 10.90 | 10.90 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 1 | 11.90 | 11.90 | 11.90 | 11.90 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 1 | 12.20 | 12.20 | 12.20 | 12.20 |
| production/C/cold-source-1-group-tree//api/storage/user/action | 2 | 43.90 | 44.80 | 42.90 | 44.90 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 4 | 16.65 | 39.43 | 7.70 | 43.10 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 1 | 30.40 | 30.40 | 30.40 | 30.40 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 4.10 | 4.10 | 4.10 | 4.10 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 4.00 | 4.00 | 4.00 | 4.00 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 3 | 11.90 | 12.71 | 6.80 | 12.80 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 1 | 10.60 | 10.60 | 10.60 | 10.60 |
| production/C/cold-source-2-group-tree//api/storage/user/action | 2 | 24.65 | 24.88 | 24.40 | 24.90 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 5 | 11.00 | 24.16 | 6.90 | 24.20 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 1 | 11.90 | 11.90 | 11.90 | 11.90 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 2 | 8.90 | 10.79 | 6.80 | 11.00 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 1 | 10.90 | 10.90 | 10.90 | 10.90 |
| development/C/cold-rich-1-group-tree//api/storage/user/action | 3 | 21.50 | 89.09 | 13.70 | 96.60 |
| development/C/cold-rich-1-group-tree//api/workspace-files/read | 1 | 104.10 | 104.10 | 104.10 | 104.10 |
| development/C/cold-rich-1-group-tree//_nuxt/components/editor-workbench/MarkdownEditorView.vue | 2 | 56.00 | 63.74 | 47.40 | 64.60 |
| development/C/cold-rich-1-group-tree//_nuxt/components/markdown-studio/MarkdownCommentFlowPanel.vue | 1 | 46.50 | 46.50 | 46.50 | 46.50 |
| development/C/cold-rich-1-group-tree//_nuxt/composables/useMarkdownEditorController.ts | 1 | 51.20 | 51.20 | 51.20 | 51.20 |
| development/C/hot-rich-1-group-tree//api/storage/user/action | 2 | 18.90 | 19.71 | 18.00 | 19.80 |
| development/C/hot-rich-1-group-tree//api/storage/project/action | 1 | 14.10 | 14.10 | 14.10 | 14.10 |
| development/C/hot-rich-1-group-tab//api/storage/project/action | 1 | 15.90 | 15.90 | 15.90 | 15.90 |
| development/C/cold-rich-2-group-tree//api/workspace-files/read | 1 | 15.20 | 15.20 | 15.20 | 15.20 |
| development/C/cold-rich-2-group-tree//api/storage/project/action | 1 | 13.40 | 13.40 | 13.40 | 13.40 |
| development/C/hot-rich-2-group-tab//api/storage/project/action | 1 | 14.40 | 14.40 | 14.40 | 14.40 |
| development/C/cold-source-1-group-tree//api/workspace-files/read | 1 | 12.60 | 12.60 | 12.60 | 12.60 |
| development/C/cold-source-1-group-tree//api/storage/user/action | 1 | 7.90 | 7.90 | 7.90 | 7.90 |
| development/C/cold-source-1-group-tree//_nuxt/components/editor-workbench/CodeEditorView.vue | 1 | 31.70 | 31.70 | 31.70 | 31.70 |
| development/C/hot-source-1-group-tree//api/storage/project/action | 1 | 13.40 | 13.40 | 13.40 | 13.40 |
| development/C/hot-source-1-group-tab//api/storage/project/action | 1 | 13.30 | 13.30 | 13.30 | 13.30 |
| development/C/cold-source-2-group-tree//api/workspace-files/read | 1 | 17.80 | 17.80 | 17.80 | 17.80 |
| development/C/cold-source-2-group-tree//api/storage/project/action | 2 | 12.25 | 14.10 | 10.20 | 14.30 |
| development/C/hot-source-2-group-tree//api/storage/project/action | 2 | 10.85 | 13.96 | 7.40 | 14.30 |
| development/C/hot-source-2-group-tab//api/storage/project/action | 1 | 13.40 | 13.40 | 13.40 | 13.40 |

### 响应体传输

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 1 | 0.90 | 0.90 | 0.90 | 0.90 |
| production/A/service-cold//api/config/bootstrap | 3 | 1.20 | 1.20 | 1.20 | 1.20 |
| production/A/service-cold//api/projects/open | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/A/service-cold//api/storage/user/context | 4 | 1.05 | 1.10 | 0.80 | 1.10 |
| production/A/service-cold//favicon.ico | 1 | 0.70 | 0.70 | 0.70 | 0.70 |
| production/A/service-cold//api/projects | 1 | 1.10 | 1.10 | 1.10 | 1.10 |
| production/A/service-cold//api/workspace-files/tree | 1 | 1.40 | 1.40 | 1.40 | 1.40 |
| production/A/service-cold//api/storage/project/context | 2 | 1.75 | 1.89 | 1.60 | 1.90 |
| production/A/service-cold//api/storage/user/action | 8 | 1.05 | 2.25 | 0.70 | 2.60 |
| production/A/service-cold//api/storage/project/action | 9 | 1.10 | 1.60 | 0.80 | 1.60 |
| production/A/reopen//api/storage/user/action | 13 | 1.60 | 3.34 | 1.00 | 4.00 |
| production/A/reopen//api/auth/me | 1 | 0.80 | 0.80 | 0.80 | 0.80 |
| production/A/reopen//api/config/bootstrap | 3 | 1.00 | 1.00 | 0.90 | 1.00 |
| production/A/reopen//api/projects/open | 1 | 1.20 | 1.20 | 1.20 | 1.20 |
| production/A/reopen//api/storage/user/context | 4 | 1.10 | 1.62 | 0.90 | 1.70 |
| production/A/reopen//favicon.ico | 1 | 1.10 | 1.10 | 1.10 | 1.10 |
| production/A/reopen//api/projects | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/A/reopen//api/workspace-files/tree | 1 | 1.20 | 1.20 | 1.20 | 1.20 |
| production/A/reopen//api/storage/project/context | 2 | 3.15 | 3.64 | 2.60 | 3.70 |
| production/A/reopen//api/storage/project/action | 8 | 1.05 | 1.96 | 0.80 | 2.10 |
| production/B/notes-wide//api/storage/user/action | 2 | 0.85 | 0.90 | 0.80 | 0.90 |
| production/B/notes-wide//api/storage/project/action | 1 | 0.90 | 0.90 | 0.90 | 0.90 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 1 | 1.40 | 1.40 | 1.40 | 1.40 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 1 | 0.90 | 0.90 | 0.90 | 0.90 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 1.90 | 1.90 | 1.90 | 1.90 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 0.90 | 0.90 | 0.90 | 0.90 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 2 | 1.10 | 1.37 | 0.80 | 1.40 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 1 | 0.80 | 0.80 | 0.80 | 0.80 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 1 | 0.80 | 0.80 | 0.80 | 0.80 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 1 | 0.90 | 0.90 | 0.90 | 0.90 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 1 | 0.80 | 0.80 | 0.80 | 0.80 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 1 | 0.70 | 0.70 | 0.70 | 0.70 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 1 | 0.70 | 0.70 | 0.70 | 0.70 |
| production/C/cold-source-1-group-tree//api/storage/user/action | 2 | 1.65 | 1.69 | 1.60 | 1.70 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 4 | 0.80 | 1.05 | 0.70 | 1.10 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 0.90 | 0.90 | 0.90 | 0.90 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 0.80 | 0.80 | 0.80 | 0.80 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 3 | 0.80 | 0.89 | 0.70 | 0.90 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 1 | 0.90 | 0.90 | 0.90 | 0.90 |
| production/C/cold-source-2-group-tree//api/storage/user/action | 2 | 2.85 | 3.26 | 2.40 | 3.30 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 5 | 0.80 | 1.66 | 0.70 | 1.80 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 1 | 0.90 | 0.90 | 0.90 | 0.90 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 2 | 0.85 | 0.90 | 0.80 | 0.90 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 1 | 0.70 | 0.70 | 0.70 | 0.70 |
| development/C/cold-rich-1-group-tree//api/storage/user/action | 3 | 1.00 | 1.27 | 0.90 | 1.30 |
| development/C/cold-rich-1-group-tree//api/workspace-files/read | 1 | 1.90 | 1.90 | 1.90 | 1.90 |
| development/C/cold-rich-1-group-tree//_nuxt/components/editor-workbench/MarkdownEditorView.vue | 2 | 1.35 | 1.57 | 1.10 | 1.60 |
| development/C/cold-rich-1-group-tree//_nuxt/components/markdown-studio/MarkdownCommentFlowPanel.vue | 1 | 2.40 | 2.40 | 2.40 | 2.40 |
| development/C/cold-rich-1-group-tree//_nuxt/composables/useMarkdownEditorController.ts | 1 | 1.10 | 1.10 | 1.10 | 1.10 |
| development/C/hot-rich-1-group-tree//api/storage/user/action | 2 | 1.25 | 1.66 | 0.80 | 1.70 |
| development/C/hot-rich-1-group-tree//api/storage/project/action | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/hot-rich-1-group-tab//api/storage/project/action | 1 | 0.80 | 0.80 | 0.80 | 0.80 |
| development/C/cold-rich-2-group-tree//api/workspace-files/read | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/cold-rich-2-group-tree//api/storage/project/action | 1 | 0.60 | 0.60 | 0.60 | 0.60 |
| development/C/hot-rich-2-group-tab//api/storage/project/action | 1 | 0.90 | 0.90 | 0.90 | 0.90 |
| development/C/cold-source-1-group-tree//api/workspace-files/read | 1 | 0.90 | 0.90 | 0.90 | 0.90 |
| development/C/cold-source-1-group-tree//api/storage/user/action | 1 | 1.20 | 1.20 | 1.20 | 1.20 |
| development/C/cold-source-1-group-tree//_nuxt/components/editor-workbench/CodeEditorView.vue | 1 | 2.70 | 2.70 | 2.70 | 2.70 |
| development/C/hot-source-1-group-tree//api/storage/project/action | 1 | 0.70 | 0.70 | 0.70 | 0.70 |
| development/C/hot-source-1-group-tab//api/storage/project/action | 1 | 0.80 | 0.80 | 0.80 | 0.80 |
| development/C/cold-source-2-group-tree//api/workspace-files/read | 1 | 0.80 | 0.80 | 0.80 | 0.80 |
| development/C/cold-source-2-group-tree//api/storage/project/action | 2 | 0.70 | 0.79 | 0.60 | 0.80 |
| development/C/hot-source-2-group-tree//api/storage/project/action | 2 | 0.70 | 0.70 | 0.70 | 0.70 |
| development/C/hot-source-2-group-tab//api/storage/project/action | 1 | 0.80 | 0.80 | 0.80 | 0.80 |

### Server-Timing

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold/auth.user | 1 | 1.60 | 1.60 | 1.60 | 1.60 |
| production/A/service-cold/config.bootstrap | 3 | 0.80 | 1.07 | 0.80 | 1.10 |
| production/A/service-cold/files.project.ref | 1 | 0.90 | 0.90 | 0.90 | 0.90 |
| production/A/service-cold/files.project.open | 1 | 86.30 | 86.30 | 86.30 | 86.30 |
| production/A/service-cold/projects.manifests | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| production/A/service-cold/projects.total | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| production/A/service-cold/files.tree.resolve | 1 | 6.60 | 6.60 | 6.60 | 6.60 |
| production/A/service-cold/files.tree.index | 1 | 481.40 | 481.40 | 481.40 | 481.40 |
| production/A/reopen/auth.user | 1 | 1.10 | 1.10 | 1.10 | 1.10 |
| production/A/reopen/config.bootstrap | 3 | 1.00 | 1.27 | 0.80 | 1.30 |
| production/A/reopen/files.project.ref | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| production/A/reopen/files.project.open | 1 | 70.80 | 70.80 | 70.80 | 70.80 |
| production/A/reopen/projects.manifests | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| production/A/reopen/projects.total | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| production/A/reopen/files.tree.resolve | 1 | 6.70 | 6.70 | 6.70 | 6.70 |
| production/A/reopen/files.tree.index | 1 | 235.80 | 235.80 | 235.80 | 235.80 |
| production/C/cold-rich-1-group-tree/files.read.resolve | 1 | 0.40 | 0.40 | 0.40 | 0.40 |
| production/C/cold-rich-1-group-tree/files.read.read | 1 | 3.00 | 3.00 | 3.00 | 3.00 |
| production/C/cold-rich-2-group-tree/files.read.resolve | 1 | 0.50 | 0.50 | 0.50 | 0.50 |
| production/C/cold-rich-2-group-tree/files.read.read | 1 | 1.60 | 1.60 | 1.60 | 1.60 |
| production/C/cold-source-1-group-tree/files.read.resolve | 1 | 0.40 | 0.40 | 0.40 | 0.40 |
| production/C/cold-source-1-group-tree/files.read.read | 1 | 3.40 | 3.40 | 3.40 | 3.40 |
| production/C/cold-source-2-group-tree/files.read.resolve | 1 | 0.40 | 0.40 | 0.40 | 0.40 |
| production/C/cold-source-2-group-tree/files.read.read | 1 | 1.80 | 1.80 | 1.80 | 1.80 |
| development/C/cold-rich-1-group-tree/files.read.resolve | 1 | 0.60 | 0.60 | 0.60 | 0.60 |
| development/C/cold-rich-1-group-tree/files.read.read | 1 | 3.60 | 3.60 | 3.60 | 3.60 |
| development/C/cold-rich-2-group-tree/files.read.resolve | 1 | 0.50 | 0.50 | 0.50 | 0.50 |
| development/C/cold-rich-2-group-tree/files.read.read | 1 | 2.70 | 2.70 | 2.70 | 2.70 |
| development/C/cold-source-1-group-tree/files.read.resolve | 1 | 0.60 | 0.60 | 0.60 | 0.60 |
| development/C/cold-source-1-group-tree/files.read.read | 1 | 2.30 | 2.30 | 2.30 | 2.30 |
| development/C/cold-source-2-group-tree/files.read.resolve | 1 | 0.80 | 0.80 | 0.80 | 0.80 |
| development/C/cold-source-2-group-tree/files.read.read | 1 | 5.10 | 5.10 | 5.10 | 5.10 |

### User Timing

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold/files.tree.client | 1 | 514.30 | 514.30 | 514.30 | 514.30 |
| production/A/service-cold/files.tree.project | 1 | 3.60 | 3.60 | 3.60 | 3.60 |
| production/A/service-cold/files.tree.build | 1 | 1.40 | 1.40 | 1.40 | 1.40 |
| production/A/reopen/files.tree.client | 1 | 266.30 | 266.30 | 266.30 | 266.30 |
| production/A/reopen/files.tree.project | 1 | 2.20 | 2.20 | 2.20 | 2.20 |
| production/A/reopen/files.tree.build | 1 | 0.90 | 0.90 | 0.90 | 0.90 |
| production/C/cold-rich-1-group-tree/files.activation | 1 | 76.70 | 76.70 | 76.70 | 76.70 |
| production/C/cold-rich-1-group-tree/files.activation.read | 1 | 24.80 | 24.80 | 24.80 | 24.80 |
| production/C/cold-rich-1-group-tree/editor.session.publish | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| production/C/cold-rich-1-group-tree/editor.tiptap.create | 1 | 46.30 | 46.30 | 46.30 | 46.30 |
| production/C/cold-rich-1-group-tree/editor.tiptap.initialize | 1 | 21.60 | 21.60 | 21.60 | 21.60 |
| production/C/cold-rich-1-group-tree/editor.view.publish | 1 | 0.30 | 0.30 | 0.30 | 0.30 |
| production/C/hot-rich-1-group-tree/files.activation | 1 | 36.10 | 36.10 | 36.10 | 36.10 |
| production/C/hot-rich-1-group-tree/editor.session.publish | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| production/C/hot-rich-1-group-tree/editor.view.publish | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| production/C/hot-rich-1-group-tab/editor.session.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| production/C/hot-rich-1-group-tab/files.activation | 1 | 27.70 | 27.70 | 27.70 | 27.70 |
| production/C/hot-rich-1-group-tab/editor.view.publish | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| production/C/cold-rich-2-group-tree/files.activation.read | 1 | 32.80 | 32.80 | 32.80 | 32.80 |
| production/C/cold-rich-2-group-tree/files.activation | 1 | 62.10 | 62.10 | 62.10 | 62.10 |
| production/C/cold-rich-2-group-tree/editor.session.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| production/C/cold-rich-2-group-tree/editor.tiptap.create | 1 | 35.90 | 35.90 | 35.90 | 35.90 |
| production/C/cold-rich-2-group-tree/editor.tiptap.initialize | 1 | 31.20 | 31.20 | 31.20 | 31.20 |
| production/C/cold-rich-2-group-tree/editor.view.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| production/C/hot-rich-2-group-tree/editor.session.publish | 1 | 0.40 | 0.40 | 0.40 | 0.40 |
| production/C/hot-rich-2-group-tree/files.activation | 1 | 42.20 | 42.20 | 42.20 | 42.20 |
| production/C/hot-rich-2-group-tree/editor.view.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| production/C/hot-rich-2-group-tab/editor.session.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| production/C/hot-rich-2-group-tab/files.activation | 1 | 28.40 | 28.40 | 28.40 | 28.40 |
| production/C/hot-rich-2-group-tab/editor.view.publish | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-source-1-group-tree/files.activation | 1 | 87.80 | 87.80 | 87.80 | 87.80 |
| production/C/cold-source-1-group-tree/files.activation.read | 1 | 33.70 | 33.70 | 33.70 | 33.70 |
| production/C/cold-source-1-group-tree/editor.session.publish | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| production/C/cold-source-1-group-tree/editor.monaco.mount | 1 | 124.50 | 124.50 | 124.50 | 124.50 |
| production/C/cold-source-1-group-tree/editor.monaco.model | 1 | 5.20 | 5.20 | 5.20 | 5.20 |
| production/C/cold-source-1-group-tree/editor.monaco.create | 1 | 103.50 | 103.50 | 103.50 | 103.50 |
| production/C/cold-source-1-group-tree/editor.view.publish | 1 | 0.30 | 0.30 | 0.30 | 0.30 |
| production/C/hot-source-1-group-tree/files.activation | 1 | 38.80 | 38.80 | 38.80 | 38.80 |
| production/C/hot-source-1-group-tree/editor.session.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| production/C/hot-source-1-group-tree/editor.view.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| production/C/hot-source-1-group-tab/editor.session.publish | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tab/files.activation | 1 | 29.70 | 29.70 | 29.70 | 29.70 |
| production/C/hot-source-1-group-tab/editor.view.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| production/C/cold-source-2-group-tree/files.activation | 1 | 61.10 | 61.10 | 61.10 | 61.10 |
| production/C/cold-source-2-group-tree/files.activation.read | 1 | 31.90 | 31.90 | 31.90 | 31.90 |
| production/C/cold-source-2-group-tree/editor.session.publish | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| production/C/cold-source-2-group-tree/editor.monaco.mount | 1 | 39.30 | 39.30 | 39.30 | 39.30 |
| production/C/cold-source-2-group-tree/editor.monaco.model | 1 | 0.40 | 0.40 | 0.40 | 0.40 |
| production/C/cold-source-2-group-tree/editor.monaco.create | 1 | 11.10 | 11.10 | 11.10 | 11.10 |
| production/C/cold-source-2-group-tree/editor.view.publish | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tree/editor.session.publish | 1 | 0.30 | 0.30 | 0.30 | 0.30 |
| production/C/hot-source-2-group-tree/files.activation | 1 | 37.40 | 37.40 | 37.40 | 37.40 |
| production/C/hot-source-2-group-tree/editor.view.publish | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tab/editor.session.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| production/C/hot-source-2-group-tab/files.activation | 1 | 31.70 | 31.70 | 31.70 | 31.70 |
| production/C/hot-source-2-group-tab/editor.view.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| development/C/cold-rich-1-group-tree/files.activation | 1 | 179.50 | 179.50 | 179.50 | 179.50 |
| development/C/cold-rich-1-group-tree/files.activation.read | 1 | 108.60 | 108.60 | 108.60 | 108.60 |
| development/C/cold-rich-1-group-tree/editor.session.publish | 1 | 0.40 | 0.40 | 0.40 | 0.40 |
| development/C/cold-rich-1-group-tree/editor.tiptap.create | 1 | 59.70 | 59.70 | 59.70 | 59.70 |
| development/C/cold-rich-1-group-tree/editor.tiptap.initialize | 1 | 27.90 | 27.90 | 27.90 | 27.90 |
| development/C/cold-rich-1-group-tree/editor.view.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| development/C/hot-rich-1-group-tree/editor.session.publish | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| development/C/hot-rich-1-group-tree/files.activation | 1 | 37.80 | 37.80 | 37.80 | 37.80 |
| development/C/hot-rich-1-group-tree/editor.view.publish | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-1-group-tab/editor.session.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| development/C/hot-rich-1-group-tab/files.activation | 1 | 28.50 | 28.50 | 28.50 | 28.50 |
| development/C/hot-rich-1-group-tab/editor.view.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| development/C/cold-rich-2-group-tree/files.activation | 1 | 72.80 | 72.80 | 72.80 | 72.80 |
| development/C/cold-rich-2-group-tree/files.activation.read | 1 | 34.70 | 34.70 | 34.70 | 34.70 |
| development/C/cold-rich-2-group-tree/editor.session.publish | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| development/C/cold-rich-2-group-tree/editor.tiptap.create | 1 | 42.50 | 42.50 | 42.50 | 42.50 |
| development/C/cold-rich-2-group-tree/editor.tiptap.initialize | 1 | 34.20 | 34.20 | 34.20 | 34.20 |
| development/C/cold-rich-2-group-tree/editor.view.publish | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| development/C/hot-rich-2-group-tree/editor.session.publish | 1 | 0.30 | 0.30 | 0.30 | 0.30 |
| development/C/hot-rich-2-group-tree/files.activation | 1 | 38.60 | 38.60 | 38.60 | 38.60 |
| development/C/hot-rich-2-group-tree/editor.view.publish | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-2-group-tab/editor.session.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| development/C/hot-rich-2-group-tab/files.activation | 1 | 30.50 | 30.50 | 30.50 | 30.50 |
| development/C/hot-rich-2-group-tab/editor.view.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| development/C/cold-source-1-group-tree/files.activation.read | 1 | 27.30 | 27.30 | 27.30 | 27.30 |
| development/C/cold-source-1-group-tree/files.activation | 1 | 59.40 | 59.40 | 59.40 | 59.40 |
| development/C/cold-source-1-group-tree/editor.session.publish | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-source-1-group-tree/editor.monaco.mount | 1 | 187.40 | 187.40 | 187.40 | 187.40 |
| development/C/cold-source-1-group-tree/editor.monaco.model | 1 | 6.70 | 6.70 | 6.70 | 6.70 |
| development/C/cold-source-1-group-tree/editor.monaco.create | 1 | 161.70 | 161.70 | 161.70 | 161.70 |
| development/C/cold-source-1-group-tree/editor.view.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| development/C/hot-source-1-group-tree/editor.session.publish | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| development/C/hot-source-1-group-tree/files.activation | 1 | 41.80 | 41.80 | 41.80 | 41.80 |
| development/C/hot-source-1-group-tree/editor.view.publish | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-1-group-tab/editor.session.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| development/C/hot-source-1-group-tab/files.activation | 1 | 36.60 | 36.60 | 36.60 | 36.60 |
| development/C/hot-source-1-group-tab/editor.view.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| development/C/cold-source-2-group-tree/files.activation.read | 1 | 38.60 | 38.60 | 38.60 | 38.60 |
| development/C/cold-source-2-group-tree/files.activation | 1 | 68.20 | 68.20 | 68.20 | 68.20 |
| development/C/cold-source-2-group-tree/editor.session.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| development/C/cold-source-2-group-tree/editor.monaco.mount | 1 | 43.70 | 43.70 | 43.70 | 43.70 |
| development/C/cold-source-2-group-tree/editor.monaco.model | 1 | 0.30 | 0.30 | 0.30 | 0.30 |
| development/C/cold-source-2-group-tree/editor.monaco.create | 1 | 12.10 | 12.10 | 12.10 | 12.10 |
| development/C/cold-source-2-group-tree/editor.view.publish | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-2-group-tree/files.activation | 1 | 43.70 | 43.70 | 43.70 | 43.70 |
| development/C/hot-source-2-group-tree/editor.session.publish | 1 | 0.20 | 0.20 | 0.20 | 0.20 |
| development/C/hot-source-2-group-tree/editor.view.publish | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-2-group-tab/editor.session.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |
| development/C/hot-source-2-group-tab/files.activation | 1 | 36.70 | 36.70 | 36.70 | 36.70 |
| development/C/hot-source-2-group-tab/editor.view.publish | 1 | 0.10 | 0.10 | 0.10 | 0.10 |

### 各操作最长主线程任务

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold | 1 | 120.00 | 120.00 | 120.00 | 120.00 |
| production/A/reopen | 1 | 91.00 | 91.00 | 91.00 | 91.00 |
| production/B/notes-wide | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-rich-1-group-tree | 1 | 66.00 | 66.00 | 66.00 | 66.00 |
| production/C/hot-rich-1-group-tree | 1 | 54.00 | 54.00 | 54.00 | 54.00 |
| production/C/hot-rich-1-group-tab | 1 | 51.00 | 51.00 | 51.00 | 51.00 |
| production/C/cold-rich-2-group-tree | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tree | 1 | 64.00 | 64.00 | 64.00 | 64.00 |
| production/C/hot-rich-2-group-tab | 1 | 54.00 | 54.00 | 54.00 | 54.00 |
| production/C/cold-source-1-group-tree | 1 | 145.00 | 145.00 | 145.00 | 145.00 |
| production/C/hot-source-1-group-tree | 1 | 58.00 | 58.00 | 58.00 | 58.00 |
| production/C/hot-source-1-group-tab | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-source-2-group-tree | 1 | 68.00 | 68.00 | 68.00 | 68.00 |
| production/C/hot-source-2-group-tree | 1 | 58.00 | 58.00 | 58.00 | 58.00 |
| production/C/hot-source-2-group-tab | 1 | 57.00 | 57.00 | 57.00 | 57.00 |
| development/C/cold-rich-1-group-tree | 1 | 86.00 | 86.00 | 86.00 | 86.00 |
| development/C/hot-rich-1-group-tree | 1 | 57.00 | 57.00 | 57.00 | 57.00 |
| development/C/hot-rich-1-group-tab | 1 | 55.00 | 55.00 | 55.00 | 55.00 |
| development/C/cold-rich-2-group-tree | 1 | 60.00 | 60.00 | 60.00 | 60.00 |
| development/C/hot-rich-2-group-tree | 1 | 63.00 | 63.00 | 63.00 | 63.00 |
| development/C/hot-rich-2-group-tab | 1 | 58.00 | 58.00 | 58.00 | 58.00 |
| development/C/cold-source-1-group-tree | 1 | 209.00 | 209.00 | 209.00 | 209.00 |
| development/C/hot-source-1-group-tree | 1 | 62.00 | 62.00 | 62.00 | 62.00 |
| development/C/hot-source-1-group-tab | 1 | 64.00 | 64.00 | 64.00 | 64.00 |
| development/C/cold-source-2-group-tree | 1 | 74.00 | 74.00 | 74.00 | 74.00 |
| development/C/hot-source-2-group-tree | 1 | 66.00 | 66.00 | 66.00 | 66.00 |
| development/C/hot-source-2-group-tab | 1 | 65.00 | 65.00 | 65.00 | 65.00 |

## 性能标准对照

采用 p95 与规范时限作对照；规范本身没有指定分位数，因此本表是报告约定，不是改写产品合同。

| 变体 | 规范时限 ms | 实测 p95 ms | 结果 |
|---|---:|---:|---|
| production/A/service-cold | 1000 | 815.80 | p95 达到 |
| production/A/reopen | 300 | 606.40 | p95 超出 |
| production/C/cold-rich-1-group-tree | 200 | 372.70 | p95 超出 |
| production/C/hot-rich-1-group-tree | 100 | 241.80 | p95 超出 |
| production/C/hot-rich-1-group-tab | 100 | 55.30 | p95 达到 |
| production/C/cold-rich-2-group-tree | 200 | 287.20 | p95 超出 |
| production/C/hot-rich-2-group-tree | 100 | 252.20 | p95 超出 |
| production/C/hot-rich-2-group-tab | 100 | 57.40 | p95 达到 |
| production/C/cold-source-1-group-tree | 200 | 488.90 | p95 超出 |
| production/C/hot-source-1-group-tree | 100 | 269.60 | p95 超出 |
| production/C/hot-source-1-group-tab | 100 | 71.70 | p95 达到 |
| production/C/cold-source-2-group-tree | 200 | 322.40 | p95 超出 |
| production/C/hot-source-2-group-tree | 100 | 271.10 | p95 超出 |
| production/C/hot-source-2-group-tab | 100 | 79.00 | p95 达到 |

## 测量设计与环境

- 固定种子 42017，40 个 Markdown，5120–5120 bytes，共 204800 bytes；root: 1 (2.50%)；lorebook: 11 (27.50%)；manuscript: 12 (30.00%)；notes: 16 (40.00%)。普通主体目录深度 3–5 层；index.md 与宽目录是明确的浅层入口。
- 用真实 POST /api/projects 创建项目后写入返回 projectRoot 对应的隔离 State Root；项目卡片的真实 click 发起打开。rich 与 source 使用不同项目，避免旧标签与分组恢复污染。
- 起止判定：{"percentile":"线性插值，位置 (n-1)*p；仅成功且输入验证通过的样本进入统计","tree":"click 捕获事件至三个根目录已渲染、可命中，连续两个动画帧成立","directory":"直接子行全部渲染、展开动画结束，连续两个动画帧成立","editor":"当前活动组目标标签选中、正确标记出现在可见编辑器、输入可写且不 busy；连续两个动画帧成立；窗口外输入并撤销","cold":"A 每次重启服务；C 每次用该项目中从未打开的文件；不清 OS 页缓存","desktop":"桌面版未测"}。
- 样本统计保留 Resource Timing、Server-Timing、固定名字的 User Timing measure、Long Tasks、Long Animation Frames 原始条目；每个样本记录 loadAverage。常驻计时不生成 mark 或序号名字。
- 环境：{"hostname":"archlinux","platform":"linux","arch":"x64","bun":"1.4.2","cpuModel":"Intel(R) Core(TM) i5-1035G1 CPU @ 1.00GHz","cpuCount":8,"memoryBytes":16429027328,"chrome":"151.0.7922.71","loadAtStart":[0.96,1.04,0.99],"loadAtEnd":[1.91,1.42,1.13],"viewport":{"width":1440,"height":1000},"headless":true}。
- State Root：/tmp/neuro-book/t42-files-baseline-EPRLw8/state；样本、State Root 与独立 Chrome profile 已清理=true；仅超限 profiling 文件留存=[]。
- 构建日志：/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-spa-smoke-2-build.log；命令与逐次服务启动日志与报告同目录。

- 生产矩阵续跑来源：{"reportPath":"/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-smoke-report.json","generatedAt":"2026-10-03T06:11:30.531Z","sourceRevision":"a7346d225d48b8496078001a5ddfa656da85e827","sourceCompleted":false,"sourceDiagnostics":["waitFor: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator('[data-project-picker-view], [data-role=\"files-explorer-view\"]').first() to be visible\n    - waiting for \"http://127.0.0.1:40557/\" navigation to finish...\n    - navigated to \"http://127.0.0.1:40557/\"\n\n    at loginAndOpenBase (/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/packages/neuro-book/scripts/perf/files-baseline.ts:175:97)\n    at async restart (/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/packages/neuro-book/scripts/perf/files-baseline.ts:223:11)\n    at async main (/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/packages/neuro-book/scripts/perf/files-baseline.ts:424:19)\n    at processTicksAndRejections (native:7:39)"],"environment":{"hostname":"archlinux","platform":"linux","arch":"x64","bun":"1.4.2","cpuModel":"Intel(R) Core(TM) i5-1035G1 CPU @ 1.00GHz","cpuCount":8,"memoryBytes":16429027328,"chrome":"151.0.7922.71","loadAtStart":[1.47,1,1.09],"loadAtEnd":[2.25,1.56,1.3],"viewport":{"width":1440,"height":1000},"headless":true},"stateCleaned":true,"rawCount":15}。历史失败不计为本轮诊断，原报告与 raw 保持原样；本轮只补开发 C 与代表项目打开 profiling。

## 跟踪与 CPU 采样

| 运行 | 采样对象 | CPU 样本数 | 分类采样 ms | 原始文件 |
|---|---|---:|---|---|
| review-1-development-smoke-directory-expand | browser | 335 | {"未归类 CPU":78.668,"空闲或原生未归类":198.1320000000001} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-smoke-directory-expand.cpuprofile (19983 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-smoke-directory-expand.trace.json (388521 bytes) |
| review-1-development-smoke-production-rich-1-group | browser | 372 | {"空闲或原生未归类":122.85099999999997,"未归类 CPU":107.10100000000004,"Vue 深度遍历":40.696,"富文本控件与视图":7.204000000000001,"Vue 更新":0.548} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-smoke-production-rich-1-group.cpuprofile (150269 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-smoke-production-rich-1-group.trace.json (322371 bytes) |
| review-1-development-smoke-production-rich-2-group | browser | 372 | {"未归类 CPU":118.24499999999999,"空闲或原生未归类":126.06200000000001,"Vue 深度遍历":46.38900000000001,"富文本控件与视图":9.032,"Monaco 模型与控件":1.072} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-smoke-production-rich-2-group.cpuprofile (152452 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-smoke-production-rich-2-group.trace.json (323182 bytes) |
| review-1-development-smoke-production-source-1-group | browser | 384 | {"未归类 CPU":133.63499993896474,"空闲或原生未归类":122.239,"Vue 深度遍历":45.735,"Vue 更新":8.14,"Monaco 模型与控件":9.623000000000001,"富文本控件与视图":1.257,"垃圾回收":2.1710000000000003} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-smoke-production-source-1-group.cpuprofile (177553 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-smoke-production-source-1-group.trace.json (348863 bytes) |
| review-1-development-smoke-production-source-2-group | browser | 391 | {"未归类 CPU":144.963,"Vue 更新":9.575000000000001,"空闲或原生未归类":118.784,"Vue 深度遍历":39.668,"Monaco 模型与控件":7.945999999999999,"富文本控件与视图":1.064} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-smoke-production-source-2-group.cpuprofile (182090 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-smoke-production-source-2-group.trace.json (347131 bytes) |
| review-1-spa-smoke-2-development-rich-1-group | browser | 356 | {"未归类 CPU":70.3449999389649,"Vue 更新":27.230999999999995,"空闲或原生未归类":130.376,"富文本控件与视图":17.288999999999998,"Vue 深度遍历":44.159} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-spa-smoke-2-development-rich-1-group.cpuprofile (261825 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-spa-smoke-2-development-rich-1-group.trace.json (319398 bytes) |
| review-1-spa-smoke-2-development-rich-2-group | browser | 399 | {"未归类 CPU":91.61099999999996,"Vue 更新":38.26,"空闲或原生未归类":114.89999999999995,"富文本控件与视图":18.247,"Vue 深度遍历":52.610000000000014,"富文本解析与模型":1.072} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-spa-smoke-2-development-rich-2-group.cpuprofile (305380 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-spa-smoke-2-development-rich-2-group.trace.json (330075 bytes) |
| review-1-spa-smoke-2-development-source-1-group | browser | 393 | {"未归类 CPU":97.32,"Vue 更新":21.017,"空闲或原生未归类":118.15199999999999,"Vue 深度遍历":44.403000000000006,"Monaco 模型与控件":44.709,"富文本控件与视图":9.936999999999998,"垃圾回收":1.662} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-spa-smoke-2-development-source-1-group.cpuprofile (318227 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-spa-smoke-2-development-source-1-group.trace.json (342330 bytes) |
| review-1-spa-smoke-2-development-source-2-group | browser | 398 | {"未归类 CPU":102.9349999389648,"Vue 更新":25.393999999999995,"空闲或原生未归类":124.402,"Vue 深度遍历":43.346,"富文本控件与视图":7.066,"Monaco 模型与控件":34.257} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-spa-smoke-2-development-source-2-group.cpuprofile (294129 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-spa-smoke-2-development-source-2-group.trace.json (318804 bytes) |
| review-1-spa-smoke-2-project-open | browser | 1229 | {"未归类 CPU":411.9970000610351,"空闲或原生未归类":401.5169999999997,"Vue 深度遍历":51.23199999999999,"垃圾回收":9.454} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-spa-smoke-2-project-open.cpuprofile (487361 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-spa-smoke-2-project-open.trace.json (1178905 bytes) |
| review-1-spa-smoke-2-server-project-open | server | 556 | {"未归类 CPU":709.0517499999995,"目录与索引（含路径校验）":55.81099999999999,"垃圾回收":1.003,"frontmatter 与 YAML":99.699,"文件读取 CPU":1.132,"索引问题校验":7.503} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-spa-smoke-2-server-project-open.cpuprofile (732675 bytes) |

服务 CPU profile 使用 Bun --cpu-prof，采样真正 .output/server/index.mjs 进程；按 performance.timeOrigin 与 startTime 对齐，只统计代表性打开窗口。parseMarkdownDocument、scanWorkspaceTree、visitPath、buildWorkspaceNode、createProjectIssues、readWorkspaceTextFile 在本次构建 AST 中以独特函数体识别，记录压缩名、行列与 matchedBy；仅唯一匹配映射参与祖先栈归类。frontmatter 优先于其外层索引栈，未归类部分保留；CPU 采样不等于异步 I/O wall-clock。
Chrome 使用 1000 µs CPU sampling 和 devtools.timeline/blink.user_timing/v8.execute trace。独立采样脚本的 files.baseline.profile-clock mark 对齐 monotonic 微秒时钟；只统计 sample click-to-ready 窗口，trace 只取同 pid/tid 页面主线程。Vue traverse 以 __v_skip/new Map/Object.getOwnPropertySymbols/propertyIsEnumerable 独特函数体唯一识别，匹配真实脚本 URL 与函数行列范围后归为 Vue 深度遍历；其余按 parseMarkdown/createDoc/createSchema/DOMParser 归类解析与模型、EditorView/createView/updateState 归类富文本控件、Monaco model/widget/tokenizer、建树和 Vue 祖先栈归类。未识别部分保留未归类。Layout/UpdateLayoutTree/Paint 与 RunTask/FunctionCall 嵌套，不能相加。独立时钟 mark 会立即清理，不进入常规样本。

CPU 时间重建：累加 timeDeltas 得到时间戳后排序，再按非重叠相邻区间归类；负 delta 数量保留于 cpu.negativeDeltaCount，原始 profile 不改写。协议参考：[CDP Profiler Profile](https://chromedevtools.github.io/devtools-protocol/tot/Profiler/#type-Profile)。Monaco 原生输入宿主的判据来自已安装版本 nativeEditContext.js，并由键盘 smoke 实证。

## 常驻计时点

| 文件 | 名字 | 所有者边界 |
|---|---|---|
| server/api/projects/open.post.ts | files.project.ref | 读取并校验打开请求 |
| server/api/projects/open.post.ts | files.project.open | Project Session、索引与模块 activation 完成 |
| server/api/workspace-files/tree.get.ts | files.tree.resolve / files.tree.index / files.tree.scan | 目标解析、Project snapshot 或 plain Workspace 扫描；原 workspace.resolve / workspace.index / workspace.tree 改名 |
| server/api/workspace-files/stat.get.ts | files.stat.resolve / files.stat.read | 目标解析、文件 stat DTO |
| server/api/workspace-files/read.get.ts | files.read.resolve / files.read.read | 目标解析、文件正文与文件状态读取 |
| app/stores/novel-ide.ts | files.tree.client | 发起 tree 请求至响应 JSON 解码完成；不含状态提交 |
| app/stores/novel-ide.ts | files.activation / files.activation.stat / files.activation.read | 激活整体；stat fallback 请求；read 请求本身（read 子阶段不含 buffer/session 提交） |
| app/stores/novel-ide.ts | editor.session.publish | openTabInGroup 与 session outcome 提交 |
| app/components/novel-ide/workspace/workspace-file-tree.ts | files.tree.project / files.tree.build | 节点模式投影、扁平快照建树及排序 |
| app/components/editor-workbench/EditorViewHost.vue | editor.view.publish | 原顺序 releaseActive、lastUsed 更新、handle/actions 发布及 retained view 收口；不含异步控件创建 |
| app/components/markdown-studio/TipTapMarkdownEditor.vue | editor.tiptap.create / editor.tiptap.initialize | useEditor 配置至 onCreate；onBeforeCreate 至 onCreate（解析、模型与控件的联合阶段） |
| app/components/markdown-studio/load-monaco-editor.ts | editor.monaco.load | 首次按需模块和 worker 加载至环境建立 |
| app/components/editor-workbench/MonacoCodeEditor.vue | editor.monaco.model / editor.monaco.create / editor.monaco.mount | createModel、editor.create、onMounted 至布局与 ready 前 |

## 局限与可疑数据

1. 桌面版未测；headless Chrome 的调度与开发者日常浏览器不同。
2. 服务冷开不清 OS 页缓存，reopen 仍包含 Project module 重建。
3. Long Task 仅记录 >=50 ms 的完整任务，未出现记录不代表不存在较短阻塞；B 包含既有展开动画。
4. 常规样本包含常驻计时开销；独立 trace/profile 有额外开销，只用于构成分析。CPU 采样分类不是异步 wall-clock 的精确分割。
5. 正文输入证明位于计时窗口外，输入并撤销只用合成文件；跨帧终点含最多约两帧确认成本。

## 诊断

无未处理测量失败。
