# Files 现状耗时基线

生成时间：2026-10-03T06:05:28.121Z；HEAD：a7346d225d48b8496078001a5ddfa656da85e827；生产镜像身份详见 JSON build.image。

完整运行：失败；有效样本 410/410。桌面版未测。

## A. 打开项目

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold | 10 | 6226.30 | 7421.13 | 5928.90 | 7433.10 |
| production/A/reopen | 10 | 5814.40 | 6441.68 | 5217.90 | 6571.10 |

服务冷开每次重启自有 Product；reopen 在同进程内关闭并再次打开。两者都会经历真实 Project Session 生命周期，OS 页缓存保持自然状态。

## B. 展开宽目录

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/B/notes-wide | 30 | 363.90 | 390.21 | 347.60 | 429.40 |

目录 notes/wide/ 直接包含 400 项。终点包括所有直接子行挂载与展开动画完成。最长完整 Long Task：

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/B/notes-wide | 30 | 98.00 | 115.65 | 87.00 | 161.00 |

当前服务发布完整 tree；B 是已收到快照的客户端展开，不新增按需目录协议。请求数见 JSON，不把零 tree 请求解释为已实现按需扫描。

## C. 点击至正文可编辑

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/C/cold-rich-1-group-tree | 30 | 1531.20 | 1710.65 | 1495.20 | 2173.00 |
| production/C/hot-rich-1-group-tree | 30 | 1066.15 | 1092.85 | 1040.40 | 1117.40 |
| production/C/hot-rich-1-group-tab | 30 | 867.25 | 890.24 | 854.80 | 902.60 |
| production/C/cold-rich-2-group-tree | 30 | 1526.05 | 1596.26 | 1503.40 | 1780.20 |
| production/C/hot-rich-2-group-tree | 30 | 1057.05 | 1085.91 | 1040.20 | 1104.30 |
| production/C/hot-rich-2-group-tab | 30 | 874.70 | 883.53 | 865.00 | 899.20 |
| production/C/cold-source-1-group-tree | 30 | 1553.30 | 1620.39 | 1527.10 | 1791.10 |
| production/C/hot-source-1-group-tree | 30 | 1095.40 | 1117.88 | 1078.40 | 1344.30 |
| production/C/hot-source-1-group-tab | 30 | 909.80 | 931.44 | 896.50 | 964.30 |
| production/C/cold-source-2-group-tree | 30 | 1561.55 | 1596.82 | 1535.70 | 1598.70 |
| production/C/hot-source-2-group-tree | 30 | 1094.05 | 1172.85 | 1080.90 | 1390.40 |
| production/C/hot-source-2-group-tab | 30 | 905.90 | 969.16 | 885.90 | 1029.50 |

cold 是项目内首次打开的不同文件。hot-tree 从文件树单击两个已保留标签的文件；hot-tab 从标签按钮切换。富文本／源码、单组／双组独立记录，预热与 profiling 不进入常规统计。

冷开 read 次数：p50=1.0，p95=1.0；stat 与 read 每次计数见下表。

### 文件请求次数（单位：次）

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/C/cold-rich-1-group-tree/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-rich-1-group-tree/read | 30 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/hot-rich-1-group-tree/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tree/read | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tab/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tab/read | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-rich-2-group-tree/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-rich-2-group-tree/read | 30 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/hot-rich-2-group-tree/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tree/read | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tab/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tab/read | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-source-1-group-tree/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-source-1-group-tree/read | 30 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/hot-source-1-group-tree/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tree/read | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tab/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tab/read | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-source-2-group-tree/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-source-2-group-tree/read | 30 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/hot-source-2-group-tree/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tree/read | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tab/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tab/read | 30 | 0.00 | 0.00 | 0.00 | 0.00 |

### 选中与标签反馈

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/C/cold-rich-1-group-tree/selectionMs | 30 | 2.95 | 5.90 | 2.60 | 5.90 |
| production/C/cold-rich-1-group-tree/tabMs | 30 | 1497.70 | 1669.54 | 1465.80 | 2018.00 |
| production/C/hot-rich-1-group-tree/selectionMs | 30 | 2.95 | 6.36 | 2.50 | 8.60 |
| production/C/hot-rich-1-group-tree/tabMs | 30 | 1052.30 | 1078.40 | 1027.60 | 1104.60 |
| production/C/hot-rich-1-group-tab/selectionMs | 30 | 852.25 | 876.75 | 840.80 | 887.20 |
| production/C/hot-rich-1-group-tab/tabMs | 30 | 852.25 | 876.75 | 840.80 | 887.20 |
| production/C/cold-rich-2-group-tree/selectionMs | 30 | 2.80 | 3.31 | 2.40 | 4.10 |
| production/C/cold-rich-2-group-tree/tabMs | 30 | 1497.30 | 1563.60 | 1474.30 | 1753.10 |
| production/C/hot-rich-2-group-tree/selectionMs | 30 | 3.15 | 5.51 | 2.60 | 5.80 |
| production/C/hot-rich-2-group-tree/tabMs | 30 | 1048.00 | 1077.42 | 1030.90 | 1096.00 |
| production/C/hot-rich-2-group-tab/selectionMs | 30 | 866.00 | 874.82 | 856.10 | 890.60 |
| production/C/hot-rich-2-group-tab/tabMs | 30 | 866.00 | 874.82 | 856.10 | 890.60 |
| production/C/cold-source-1-group-tree/selectionMs | 30 | 3.45 | 4.42 | 2.90 | 5.10 |
| production/C/cold-source-1-group-tree/tabMs | 30 | 1514.35 | 1566.12 | 1490.20 | 1588.90 |
| production/C/hot-source-1-group-tree/selectionMs | 30 | 3.30 | 4.45 | 2.90 | 5.30 |
| production/C/hot-source-1-group-tree/tabMs | 30 | 1062.75 | 1086.55 | 1050.70 | 1306.00 |
| production/C/hot-source-1-group-tab/selectionMs | 30 | 880.70 | 908.64 | 867.60 | 929.30 |
| production/C/hot-source-1-group-tab/tabMs | 30 | 880.70 | 908.64 | 867.60 | 929.30 |
| production/C/cold-source-2-group-tree/selectionMs | 30 | 3.30 | 3.97 | 2.80 | 4.80 |
| production/C/cold-source-2-group-tree/tabMs | 30 | 1520.25 | 1560.24 | 1504.70 | 1566.10 |
| production/C/hot-source-2-group-tree/selectionMs | 30 | 3.30 | 4.29 | 2.90 | 6.50 |
| production/C/hot-source-2-group-tree/tabMs | 30 | 1061.55 | 1138.52 | 1052.10 | 1351.00 |
| production/C/hot-source-2-group-tab/selectionMs | 30 | 878.05 | 943.01 | 860.00 | 989.30 |
| production/C/hot-source-2-group-tab/tabMs | 30 | 878.05 | 943.01 | 860.00 | 989.30 |

### 互斥关键路径区间

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/C/cold-rich-1-group-tree/clickToActivation | 30 | 180.40 | 182.70 | 180.20 | 184.20 |
| production/C/cold-rich-1-group-tree/activationToReadEnd | 30 | 15.20 | 19.64 | 11.40 | 22.20 |
| production/C/cold-rich-1-group-tree/readEndToSession | 30 | 419.90 | 478.37 | 411.80 | 591.50 |
| production/C/cold-rich-1-group-tree/sessionToView | 30 | 884.85 | 1016.89 | 862.40 | 1332.30 |
| production/C/cold-rich-1-group-tree/viewToEditable | 30 | 28.35 | 36.51 | 24.30 | 49.90 |
| production/C/hot-rich-1-group-tree/clickToActivation | 30 | 180.40 | 183.02 | 180.20 | 183.90 |
| production/C/hot-rich-1-group-tree/activationToReadEnd | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tree/readEndToSession | 30 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-rich-1-group-tree/sessionToView | 30 | 425.45 | 455.60 | 412.10 | 458.10 |
| production/C/hot-rich-1-group-tree/viewToEditable | 30 | 456.50 | 466.06 | 445.90 | 478.90 |
| production/C/hot-rich-1-group-tab/clickToActivation | 30 | 0.10 | 0.20 | 0.10 | 0.40 |
| production/C/hot-rich-1-group-tab/activationToReadEnd | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tab/readEndToSession | 30 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-rich-1-group-tab/sessionToView | 30 | 416.55 | 429.91 | 406.90 | 438.10 |
| production/C/hot-rich-1-group-tab/viewToEditable | 30 | 449.15 | 463.62 | 443.00 | 483.60 |
| production/C/cold-rich-2-group-tree/clickToActivation | 30 | 180.40 | 183.18 | 180.20 | 184.00 |
| production/C/cold-rich-2-group-tree/activationToReadEnd | 30 | 14.10 | 17.34 | 9.50 | 18.20 |
| production/C/cold-rich-2-group-tree/readEndToSession | 30 | 422.75 | 446.95 | 405.70 | 565.10 |
| production/C/cold-rich-2-group-tree/sessionToView | 30 | 883.65 | 936.33 | 868.10 | 998.70 |
| production/C/cold-rich-2-group-tree/viewToEditable | 30 | 21.95 | 24.77 | 18.60 | 31.80 |
| production/C/hot-rich-2-group-tree/clickToActivation | 30 | 180.40 | 183.26 | 180.20 | 183.60 |
| production/C/hot-rich-2-group-tree/activationToReadEnd | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tree/readEndToSession | 30 | 0.30 | 0.40 | 0.10 | 0.40 |
| production/C/hot-rich-2-group-tree/sessionToView | 30 | 424.15 | 448.64 | 413.00 | 462.00 |
| production/C/hot-rich-2-group-tree/viewToEditable | 30 | 452.05 | 465.87 | 441.90 | 470.40 |
| production/C/hot-rich-2-group-tab/clickToActivation | 30 | 0.20 | 0.30 | 0.00 | 0.30 |
| production/C/hot-rich-2-group-tab/activationToReadEnd | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tab/readEndToSession | 30 | 0.20 | 0.25 | 0.10 | 0.30 |
| production/C/hot-rich-2-group-tab/sessionToView | 30 | 421.40 | 430.71 | 415.60 | 432.10 |
| production/C/hot-rich-2-group-tab/viewToEditable | 30 | 451.15 | 461.31 | 444.30 | 468.00 |
| production/C/cold-source-1-group-tree/clickToActivation | 30 | 181.45 | 183.92 | 180.20 | 184.30 |
| production/C/cold-source-1-group-tree/activationToReadEnd | 30 | 12.50 | 15.86 | 8.70 | 17.40 |
| production/C/cold-source-1-group-tree/readEndToSession | 30 | 432.55 | 460.76 | 418.70 | 494.60 |
| production/C/cold-source-1-group-tree/sessionToView | 30 | 877.55 | 915.62 | 863.90 | 1095.20 |
| production/C/cold-source-1-group-tree/viewToEditable | 30 | 47.45 | 54.50 | 35.80 | 80.80 |
| production/C/hot-source-1-group-tree/clickToActivation | 30 | 180.60 | 184.46 | 180.30 | 184.80 |
| production/C/hot-source-1-group-tree/activationToReadEnd | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tree/readEndToSession | 30 | 0.10 | 0.20 | 0.00 | 0.30 |
| production/C/hot-source-1-group-tree/sessionToView | 30 | 429.70 | 444.69 | 419.90 | 548.90 |
| production/C/hot-source-1-group-tree/viewToEditable | 30 | 484.65 | 495.63 | 469.60 | 614.90 |
| production/C/hot-source-1-group-tab/clickToActivation | 30 | 0.10 | 0.20 | 0.00 | 0.30 |
| production/C/hot-source-1-group-tab/activationToReadEnd | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tab/readEndToSession | 30 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-source-1-group-tab/sessionToView | 30 | 430.50 | 444.27 | 418.70 | 449.90 |
| production/C/hot-source-1-group-tab/viewToEditable | 30 | 478.20 | 502.96 | 465.90 | 515.10 |
| production/C/cold-source-2-group-tree/clickToActivation | 30 | 183.45 | 186.17 | 180.20 | 189.00 |
| production/C/cold-source-2-group-tree/activationToReadEnd | 30 | 12.60 | 15.66 | 10.10 | 17.40 |
| production/C/cold-source-2-group-tree/readEndToSession | 30 | 433.45 | 443.80 | 421.30 | 446.10 |
| production/C/cold-source-2-group-tree/sessionToView | 30 | 883.05 | 911.07 | 871.00 | 921.30 |
| production/C/cold-source-2-group-tree/viewToEditable | 30 | 45.00 | 50.07 | 39.90 | 57.60 |
| production/C/hot-source-2-group-tree/clickToActivation | 30 | 182.25 | 185.81 | 180.20 | 186.60 |
| production/C/hot-source-2-group-tree/activationToReadEnd | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tree/readEndToSession | 30 | 0.20 | 0.35 | 0.10 | 0.40 |
| production/C/hot-source-2-group-tree/sessionToView | 30 | 428.95 | 491.14 | 420.30 | 556.10 |
| production/C/hot-source-2-group-tree/viewToEditable | 30 | 481.40 | 505.17 | 468.40 | 653.50 |
| production/C/hot-source-2-group-tab/clickToActivation | 30 | 0.10 | 0.26 | 0.00 | 0.30 |
| production/C/hot-source-2-group-tab/activationToReadEnd | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tab/readEndToSession | 30 | 0.15 | 0.20 | 0.00 | 0.20 |
| production/C/hot-source-2-group-tab/sessionToView | 30 | 429.75 | 464.43 | 414.00 | 486.80 |
| production/C/hot-source-2-group-tab/viewToEditable | 30 | 477.10 | 502.71 | 465.10 | 580.00 |

这些区间按时间线单调切分，相加等于该操作总耗时。无 read 的 hot 样本不虚构网络阶段。控件与解析 measure 是嵌套子阶段，不能再次相加。

## D. 约 0.3 秒延迟

生产常规 C 样本未出现 250–400 ms 操作；开发对照是否完成见下文，不把较慢或较快操作自动称为约 0.3 秒复现。

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| 生产 250–400 ms 样本 | 0 | 未取得 | 未取得 | 未取得 | 未取得 |

代表样本：未取得。

| 区间 | 耗时 ms |
|---|---:|

开发模式对照：未测，生产已复现且未要求强制开发对照。

## 与 t16、t24 的可比性

t16/t24 在 Windows、Chromium 151.0.7922.34、Source Dev、1440×1000 下测两个 8 KiB permanent 标签，3×30 次；t24 富文本单组 p50/p95=33.5/38.0 ms，源码单组=43.5/53.8 ms。本轮是 Linux、headless Chrome、生产构建、约 3000 个 5–30 KiB 文件，每格 30 次，输入证明逐样本进行。视口和 capture-click 起点相同，但构建、平台、文件大小、工程规模与跨帧终点不同，不能直接计算回归幅度。

仅 hot-tab 的入口与历史标签切换对应；hot-tree 保留既有 180 ms 单击等待，不与 t24 标签值直接比较。双组 hot-tab 也保留为补充，本轮要求的单组富文本／源码两格均有独立样本。

## 网络与阶段分解

### 每次操作请求总数（单位：次）

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold | 10 | 47.00 | 61.75 | 47.00 | 64.00 |
| production/A/reopen | 10 | 47.50 | 53.95 | 42.00 | 58.00 |
| production/B/notes-wide | 30 | 2.00 | 5.10 | 2.00 | 6.00 |
| production/C/cold-rich-1-group-tree | 30 | 3.00 | 6.00 | 2.00 | 9.00 |
| production/C/hot-rich-1-group-tree | 30 | 1.00 | 4.00 | 1.00 | 4.00 |
| production/C/hot-rich-1-group-tab | 30 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/cold-rich-2-group-tree | 30 | 3.00 | 6.00 | 2.00 | 6.00 |
| production/C/hot-rich-2-group-tree | 30 | 1.00 | 4.00 | 1.00 | 4.00 |
| production/C/hot-rich-2-group-tab | 30 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/cold-source-1-group-tree | 30 | 4.00 | 8.55 | 2.00 | 10.00 |
| production/C/hot-source-1-group-tree | 30 | 2.00 | 5.00 | 1.00 | 7.00 |
| production/C/hot-source-1-group-tab | 30 | 1.00 | 2.00 | 1.00 | 2.00 |
| production/C/cold-source-2-group-tree | 30 | 3.50 | 7.00 | 2.00 | 7.00 |
| production/C/hot-source-2-group-tree | 30 | 2.00 | 4.00 | 1.00 | 5.00 |
| production/C/hot-source-2-group-tab | 30 | 1.00 | 2.55 | 1.00 | 3.00 |

### 每个请求耗时

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 10 | 11.05 | 15.41 | 9.10 | 16.40 |
| production/A/service-cold//api/config/bootstrap | 30 | 12.95 | 34.25 | 8.10 | 84.40 |
| production/A/service-cold//api/projects/open | 10 | 465.25 | 542.13 | 444.30 | 543.70 |
| production/A/service-cold//api/storage/user/context | 43 | 34.40 | 49.36 | 19.90 | 95.70 |
| production/A/service-cold//favicon.ico | 10 | 27.60 | 35.23 | 16.30 | 36.40 |
| production/A/service-cold//api/storage/user/action | 213 | 37.60 | 263.46 | 9.20 | 537.70 |
| production/A/service-cold//api/projects | 10 | 25.70 | 45.77 | 9.90 | 51.30 |
| production/A/service-cold//api/workspace-files/tree | 10 | 3618.95 | 4690.75 | 3430.50 | 4752.90 |
| production/A/service-cold//api/storage/project/context | 20 | 55.90 | 117.21 | 44.70 | 121.20 |
| production/A/service-cold//api/storage/project/action | 159 | 34.40 | 67.99 | 10.30 | 90.90 |
| production/A/reopen//api/auth/me | 10 | 8.60 | 13.16 | 6.50 | 15.10 |
| production/A/reopen//api/config/bootstrap | 30 | 14.70 | 25.15 | 6.80 | 26.80 |
| production/A/reopen//api/projects/open | 10 | 404.70 | 483.37 | 376.70 | 501.60 |
| production/A/reopen//api/storage/user/context | 40 | 24.25 | 30.34 | 17.40 | 37.10 |
| production/A/reopen//favicon.ico | 10 | 12.60 | 22.58 | 8.40 | 23.30 |
| production/A/reopen//api/storage/user/action | 192 | 24.65 | 49.19 | 7.80 | 398.60 |
| production/A/reopen//api/projects | 10 | 12.20 | 28.11 | 7.10 | 29.10 |
| production/A/reopen//api/workspace-files/tree | 10 | 3291.70 | 3791.93 | 2858.00 | 3961.80 |
| production/A/reopen//api/storage/project/context | 20 | 42.20 | 52.52 | 26.20 | 52.90 |
| production/A/reopen//api/storage/project/action | 143 | 21.60 | 39.70 | 9.30 | 48.20 |
| production/B/notes-wide//api/storage/user/action | 64 | 11.60 | 20.77 | 8.10 | 38.40 |
| production/B/notes-wide//api/storage/project/action | 9 | 19.80 | 38.30 | 8.00 | 38.70 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 17 | 20.50 | 66.72 | 9.40 | 68.80 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 30 | 14.60 | 18.99 | 10.90 | 21.50 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 32.30 | 32.30 | 32.30 | 32.30 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 18.60 | 18.60 | 18.60 | 18.60 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 67 | 15.60 | 20.91 | 9.10 | 50.60 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 40 | 15.35 | 24.02 | 8.80 | 25.30 |
| production/C/hot-rich-1-group-tree//api/storage/user/action | 10 | 23.90 | 35.02 | 9.40 | 35.20 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 30 | 15.70 | 19.68 | 12.50 | 21.20 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 73 | 14.90 | 22.42 | 8.70 | 24.60 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 30 | 13.55 | 16.70 | 9.20 | 17.60 |
| production/C/cold-rich-2-group-tree//api/storage/user/action | 13 | 19.20 | 22.16 | 8.70 | 22.70 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 39 | 15.50 | 25.76 | 12.60 | 26.70 |
| production/C/hot-rich-2-group-tree//api/storage/user/action | 17 | 17.60 | 21.66 | 15.50 | 22.30 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 30 | 15.40 | 19.47 | 12.70 | 21.90 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 30 | 11.95 | 15.26 | 8.50 | 16.60 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 77 | 14.90 | 32.10 | 7.70 | 36.60 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 14.60 | 14.60 | 14.60 | 14.60 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 5.70 | 5.70 | 5.70 | 5.70 |
| production/C/cold-source-1-group-tree//api/storage/user/action | 13 | 24.60 | 27.90 | 15.80 | 28.80 |
| production/C/cold-source-1-group-tree//_nuxt/editor.worker-CdQrwHl8.js | 1 | -9.30 | -9.30 | -9.30 | -9.30 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 62 | 14.15 | 24.47 | 8.20 | 36.40 |
| production/C/hot-source-1-group-tree//api/storage/user/action | 16 | 28.65 | 34.35 | 22.80 | 35.40 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 40 | 15.35 | 18.00 | 8.30 | 19.90 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 74 | 14.30 | 18.50 | 8.00 | 22.10 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 30 | 12.10 | 15.11 | 9.60 | 17.00 |
| production/C/cold-source-2-group-tree//api/storage/user/action | 16 | 22.70 | 25.70 | 19.60 | 25.70 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 56 | 14.60 | 20.40 | 8.50 | 23.20 |
| production/C/hot-source-2-group-tree//api/storage/user/action | 4 | 26.45 | 27.86 | 25.40 | 28.10 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 40 | 14.95 | 17.61 | 8.80 | 20.30 |

### 每个请求响应体大小（单位：bytes，encodedBodySize）

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 10 | 113.00 | 113.00 | 113.00 | 113.00 |
| production/A/service-cold//api/config/bootstrap | 30 | 302.00 | 302.00 | 301.00 | 302.00 |
| production/A/service-cold//api/projects/open | 10 | 275.00 | 275.00 | 275.00 | 275.00 |
| production/A/service-cold//api/storage/user/context | 43 | 17.00 | 80.00 | 17.00 | 80.00 |
| production/A/service-cold//favicon.ico | 10 | 78.00 | 78.00 | 78.00 | 78.00 |
| production/A/service-cold//api/storage/user/action | 213 | 98.00 | 98.00 | 48.00 | 104.00 |
| production/A/service-cold//api/projects | 10 | 210.00 | 210.00 | 210.00 | 210.00 |
| production/A/service-cold//api/workspace-files/tree | 10 | 4402679.00 | 4402679.00 | 4402679.00 | 4402679.00 |
| production/A/service-cold//api/storage/project/context | 20 | 80.00 | 80.00 | 80.00 | 80.00 |
| production/A/service-cold//api/storage/project/action | 159 | 98.00 | 104.00 | 48.00 | 104.00 |
| production/A/reopen//api/auth/me | 10 | 113.00 | 113.00 | 113.00 | 113.00 |
| production/A/reopen//api/config/bootstrap | 30 | 302.00 | 302.00 | 301.00 | 302.00 |
| production/A/reopen//api/projects/open | 10 | 275.00 | 275.00 | 275.00 | 275.00 |
| production/A/reopen//api/storage/user/context | 40 | 48.50 | 80.00 | 17.00 | 80.00 |
| production/A/reopen//favicon.ico | 10 | 78.00 | 78.00 | 78.00 | 78.00 |
| production/A/reopen//api/storage/user/action | 192 | 98.00 | 98.00 | 0.00 | 98.00 |
| production/A/reopen//api/projects | 10 | 210.00 | 210.00 | 210.00 | 210.00 |
| production/A/reopen//api/workspace-files/tree | 10 | 4402679.00 | 4402679.00 | 4402679.00 | 4402679.00 |
| production/A/reopen//api/storage/project/context | 20 | 80.00 | 80.00 | 80.00 | 80.00 |
| production/A/reopen//api/storage/project/action | 143 | 98.00 | 343.00 | 48.00 | 343.00 |
| production/B/notes-wide//api/storage/user/action | 64 | 104.00 | 191.00 | 98.00 | 191.00 |
| production/B/notes-wide//api/storage/project/action | 9 | 98.00 | 343.00 | 98.00 | 343.00 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 17 | 98.00 | 191.00 | 98.00 | 191.00 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 30 | 14523.00 | 30376.05 | 5490.00 | 30719.00 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 9845.00 | 9845.00 | 9845.00 | 9845.00 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 184.00 | 184.00 | 184.00 | 184.00 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 67 | 104.00 | 446.00 | 98.00 | 446.00 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 40 | 104.00 | 104.00 | 98.00 | 104.00 |
| production/C/hot-rich-1-group-tree//api/storage/user/action | 10 | 98.00 | 191.00 | 98.00 | 191.00 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 30 | 104.00 | 104.00 | 104.00 | 104.00 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 73 | 104.00 | 1007.00 | 98.00 | 1007.00 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 30 | 16308.50 | 29268.00 | 6095.00 | 30345.00 |
| production/C/cold-rich-2-group-tree//api/storage/user/action | 13 | 98.00 | 191.00 | 98.00 | 191.00 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 39 | 104.00 | 104.00 | 98.00 | 104.00 |
| production/C/hot-rich-2-group-tree//api/storage/user/action | 17 | 98.00 | 191.00 | 98.00 | 191.00 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 30 | 104.00 | 104.00 | 104.00 | 104.00 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 30 | 14525.00 | 30378.05 | 5492.00 | 30721.00 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 77 | 104.00 | 446.00 | 98.00 | 446.00 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 2210.00 | 2210.00 | 2210.00 | 2210.00 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 3650.00 | 3650.00 | 3650.00 | 3650.00 |
| production/C/cold-source-1-group-tree//api/storage/user/action | 13 | 98.00 | 191.00 | 98.00 | 191.00 |
| production/C/cold-source-1-group-tree//_nuxt/editor.worker-CdQrwHl8.js | 1 | 251810.00 | 251810.00 | 251810.00 | 251810.00 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 62 | 104.00 | 529.00 | 98.00 | 529.00 |
| production/C/hot-source-1-group-tree//api/storage/user/action | 16 | 98.00 | 191.00 | 98.00 | 191.00 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 40 | 104.00 | 529.00 | 104.00 | 529.00 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 74 | 104.00 | 1007.00 | 98.00 | 1007.00 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 30 | 16311.00 | 29270.45 | 6097.00 | 30347.00 |
| production/C/cold-source-2-group-tree//api/storage/user/action | 16 | 98.00 | 191.00 | 98.00 | 191.00 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 56 | 104.00 | 1090.00 | 98.00 | 1090.00 |
| production/C/hot-source-2-group-tree//api/storage/user/action | 4 | 98.00 | 177.05 | 98.00 | 191.00 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 40 | 104.00 | 1090.00 | 98.00 | 1090.00 |

### 首字节等待（服务执行与排队均在此内）

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 10 | 9.40 | 13.53 | 6.30 | 14.30 |
| production/A/service-cold//api/config/bootstrap | 30 | 11.35 | 30.06 | 6.20 | 74.00 |
| production/A/service-cold//api/projects/open | 10 | 463.50 | 540.19 | 442.10 | 541.50 |
| production/A/service-cold//api/storage/user/context | 43 | 32.80 | 47.60 | 10.80 | 93.90 |
| production/A/service-cold//favicon.ico | 10 | 25.45 | 33.36 | 14.50 | 34.30 |
| production/A/service-cold//api/storage/user/action | 213 | 34.80 | 259.04 | 7.50 | 535.50 |
| production/A/service-cold//api/projects | 10 | 20.85 | 33.52 | 7.10 | 35.10 |
| production/A/service-cold//api/workspace-files/tree | 10 | 3598.95 | 4670.70 | 3418.50 | 4726.50 |
| production/A/service-cold//api/storage/project/context | 20 | 52.40 | 95.26 | 38.30 | 115.40 |
| production/A/service-cold//api/storage/project/action | 159 | 32.60 | 64.32 | 8.80 | 76.80 |
| production/A/reopen//api/auth/me | 10 | 6.65 | 11.08 | 5.00 | 13.60 |
| production/A/reopen//api/config/bootstrap | 30 | 12.90 | 23.13 | 5.50 | 24.40 |
| production/A/reopen//api/projects/open | 10 | 403.00 | 481.81 | 375.30 | 499.90 |
| production/A/reopen//api/storage/user/context | 40 | 22.45 | 29.09 | 15.50 | 35.00 |
| production/A/reopen//favicon.ico | 10 | 10.45 | 20.87 | 5.70 | 21.50 |
| production/A/reopen//api/storage/user/action | 192 | 21.35 | 46.21 | 0.00 | 397.00 |
| production/A/reopen//api/projects | 10 | 10.55 | 24.88 | 5.40 | 26.50 |
| production/A/reopen//api/workspace-files/tree | 10 | 3278.75 | 3777.99 | 2846.80 | 3946.20 |
| production/A/reopen//api/storage/project/context | 20 | 30.20 | 41.52 | 24.40 | 41.80 |
| production/A/reopen//api/storage/project/action | 143 | 20.00 | 38.20 | 8.00 | 46.60 |
| production/B/notes-wide//api/storage/user/action | 64 | 10.25 | 19.25 | 6.60 | 35.20 |
| production/B/notes-wide//api/storage/project/action | 9 | 16.90 | 35.10 | 7.00 | 35.50 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 17 | 17.90 | 62.64 | 8.00 | 66.00 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 30 | 12.40 | 17.05 | 9.20 | 19.50 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 26.40 | 26.40 | 26.40 | 26.40 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 13.80 | 13.80 | 13.80 | 13.80 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 67 | 14.00 | 19.37 | 7.70 | 48.90 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 40 | 14.05 | 21.32 | 7.20 | 23.10 |
| production/C/hot-rich-1-group-tree//api/storage/user/action | 10 | 21.35 | 32.07 | 8.00 | 32.30 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 30 | 14.40 | 18.10 | 11.10 | 19.70 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 73 | 13.60 | 19.80 | 7.40 | 22.50 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 30 | 11.40 | 14.84 | 7.60 | 15.70 |
| production/C/cold-rich-2-group-tree//api/storage/user/action | 13 | 17.60 | 20.12 | 7.30 | 20.60 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 39 | 14.00 | 23.04 | 11.30 | 25.20 |
| production/C/hot-rich-2-group-tree//api/storage/user/action | 17 | 15.50 | 19.36 | 13.80 | 20.00 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 30 | 13.90 | 17.80 | 11.30 | 20.50 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 30 | 9.80 | 13.23 | 6.90 | 14.70 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 77 | 12.20 | 17.98 | 6.40 | 24.10 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 12.80 | 12.80 | 12.80 | 12.80 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 4.40 | 4.40 | 4.40 | 4.40 |
| production/C/cold-source-1-group-tree//api/storage/user/action | 13 | 21.40 | 25.04 | 14.40 | 26.00 |
| production/C/cold-source-1-group-tree//_nuxt/editor.worker-CdQrwHl8.js | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 62 | 12.30 | 17.49 | 6.90 | 23.30 |
| production/C/hot-source-1-group-tree//api/storage/user/action | 16 | 25.80 | 31.40 | 19.80 | 32.30 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 40 | 13.75 | 16.51 | 7.00 | 18.40 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 74 | 12.80 | 16.97 | 6.60 | 20.40 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 30 | 10.35 | 13.30 | 7.70 | 15.40 |
| production/C/cold-source-2-group-tree//api/storage/user/action | 16 | 20.20 | 21.80 | 18.00 | 23.00 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 56 | 13.20 | 18.27 | 7.00 | 21.00 |
| production/C/hot-source-2-group-tree//api/storage/user/action | 4 | 23.65 | 24.90 | 23.30 | 25.10 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 40 | 13.50 | 16.50 | 7.20 | 18.70 |

### 响应体传输

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 10 | 1.00 | 1.46 | 0.80 | 1.50 |
| production/A/service-cold//api/config/bootstrap | 30 | 1.15 | 1.50 | 0.80 | 1.60 |
| production/A/service-cold//api/projects/open | 10 | 1.10 | 1.36 | 0.80 | 1.50 |
| production/A/service-cold//api/storage/user/context | 43 | 1.00 | 1.87 | 0.70 | 2.10 |
| production/A/service-cold//favicon.ico | 10 | 1.00 | 1.26 | 0.80 | 1.30 |
| production/A/service-cold//api/storage/user/action | 213 | 1.30 | 3.94 | 0.80 | 9.10 |
| production/A/service-cold//api/projects | 10 | 2.15 | 3.95 | 0.90 | 5.30 |
| production/A/service-cold//api/workspace-files/tree | 10 | 11.95 | 13.68 | 10.90 | 13.90 |
| production/A/service-cold//api/storage/project/context | 20 | 1.05 | 1.71 | 0.80 | 1.80 |
| production/A/service-cold//api/storage/project/action | 159 | 1.10 | 2.30 | 0.80 | 4.20 |
| production/A/reopen//api/auth/me | 10 | 1.15 | 1.48 | 0.80 | 1.70 |
| production/A/reopen//api/config/bootstrap | 30 | 1.10 | 1.55 | 0.80 | 1.80 |
| production/A/reopen//api/projects/open | 10 | 1.00 | 1.50 | 0.80 | 1.50 |
| production/A/reopen//api/storage/user/context | 40 | 1.10 | 2.00 | 0.80 | 2.10 |
| production/A/reopen//favicon.ico | 10 | 1.40 | 1.95 | 1.00 | 2.00 |
| production/A/reopen//api/storage/user/action | 192 | 1.30 | 3.24 | 0.70 | 1771.60 |
| production/A/reopen//api/projects | 10 | 1.10 | 2.43 | 0.90 | 2.70 |
| production/A/reopen//api/workspace-files/tree | 10 | 11.80 | 14.87 | 10.70 | 15.00 |
| production/A/reopen//api/storage/project/context | 20 | 1.45 | 2.50 | 0.80 | 2.50 |
| production/A/reopen//api/storage/project/action | 143 | 1.00 | 2.00 | 0.70 | 4.80 |
| production/B/notes-wide//api/storage/user/action | 64 | 0.90 | 1.30 | 0.60 | 3.80 |
| production/B/notes-wide//api/storage/project/action | 9 | 1.40 | 3.16 | 0.70 | 3.60 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 17 | 1.70 | 2.20 | 0.80 | 2.20 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 30 | 1.10 | 1.55 | 0.90 | 1.70 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 1.90 | 1.90 | 1.90 | 1.90 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 1.90 | 1.90 | 1.90 | 1.90 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 67 | 0.90 | 1.40 | 0.70 | 1.50 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 40 | 0.90 | 1.80 | 0.60 | 2.10 |
| production/C/hot-rich-1-group-tree//api/storage/user/action | 10 | 1.75 | 2.27 | 0.90 | 2.50 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 30 | 0.90 | 1.26 | 0.70 | 1.30 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 73 | 0.80 | 1.84 | 0.60 | 2.80 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 30 | 1.00 | 1.40 | 0.80 | 1.50 |
| production/C/cold-rich-2-group-tree//api/storage/user/action | 13 | 1.20 | 1.84 | 0.70 | 2.20 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 39 | 0.90 | 2.00 | 0.70 | 2.20 |
| production/C/hot-rich-2-group-tree//api/storage/user/action | 17 | 1.60 | 2.40 | 0.80 | 2.40 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 30 | 0.80 | 1.20 | 0.70 | 1.30 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 30 | 1.00 | 1.46 | 0.80 | 1.70 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 77 | 0.90 | 1.32 | 0.70 | 1.50 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 1.20 | 1.20 | 1.20 | 1.20 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 0.70 | 0.70 | 0.70 | 0.70 |
| production/C/cold-source-1-group-tree//api/storage/user/action | 13 | 1.80 | 2.60 | 0.80 | 2.60 |
| production/C/cold-source-1-group-tree//_nuxt/editor.worker-CdQrwHl8.js | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 62 | 0.90 | 1.49 | 0.70 | 1.70 |
| production/C/hot-source-1-group-tree//api/storage/user/action | 16 | 1.95 | 2.70 | 0.90 | 2.70 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 40 | 0.90 | 1.20 | 0.70 | 1.30 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 74 | 0.90 | 1.40 | 0.70 | 2.10 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 30 | 1.00 | 1.41 | 0.80 | 1.50 |
| production/C/cold-source-2-group-tree//api/storage/user/action | 16 | 2.10 | 3.35 | 0.80 | 4.10 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 56 | 0.90 | 1.33 | 0.70 | 1.70 |
| production/C/hot-source-2-group-tree//api/storage/user/action | 4 | 2.05 | 2.38 | 1.10 | 2.40 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 40 | 0.90 | 1.40 | 0.80 | 1.50 |

### Server-Timing

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold/auth.user | 10 | 1.65 | 3.00 | 1.30 | 3.50 |
| production/A/service-cold/config.bootstrap | 30 | 1.00 | 2.46 | 0.60 | 4.20 |
| production/A/service-cold/files.project.ref | 10 | 1.25 | 1.56 | 0.80 | 1.70 |
| production/A/service-cold/files.project.open | 10 | 451.25 | 512.33 | 427.80 | 512.60 |
| production/A/service-cold/projects.manifests | 10 | 0.20 | 0.25 | 0.20 | 0.30 |
| production/A/service-cold/projects.total | 10 | 0.20 | 0.30 | 0.20 | 0.30 |
| production/A/service-cold/files.tree.resolve | 10 | 5.40 | 8.76 | 2.60 | 9.80 |
| production/A/service-cold/files.tree.index | 10 | 3544.60 | 4581.66 | 3366.60 | 4606.50 |
| production/A/reopen/auth.user | 10 | 1.15 | 1.45 | 0.90 | 1.50 |
| production/A/reopen/config.bootstrap | 30 | 0.80 | 1.75 | 0.50 | 6.90 |
| production/A/reopen/files.project.ref | 10 | 0.20 | 0.30 | 0.10 | 0.30 |
| production/A/reopen/files.project.open | 10 | 389.80 | 466.86 | 351.00 | 485.90 |
| production/A/reopen/projects.manifests | 10 | 0.10 | 0.20 | 0.10 | 0.20 |
| production/A/reopen/projects.total | 10 | 0.20 | 0.20 | 0.10 | 0.20 |
| production/A/reopen/files.tree.resolve | 10 | 2.75 | 5.22 | 2.20 | 5.40 |
| production/A/reopen/files.tree.index | 10 | 3233.55 | 3728.77 | 2809.20 | 3896.80 |
| production/C/cold-rich-1-group-tree/files.read.resolve | 30 | 0.40 | 0.65 | 0.20 | 0.70 |
| production/C/cold-rich-1-group-tree/files.read.read | 30 | 2.30 | 4.79 | 1.50 | 6.50 |
| production/C/cold-rich-2-group-tree/files.read.resolve | 30 | 0.40 | 0.40 | 0.30 | 0.50 |
| production/C/cold-rich-2-group-tree/files.read.read | 30 | 1.90 | 2.61 | 1.60 | 3.00 |
| production/C/cold-source-1-group-tree/files.read.resolve | 30 | 0.40 | 0.55 | 0.30 | 0.60 |
| production/C/cold-source-1-group-tree/files.read.read | 30 | 1.70 | 2.41 | 1.40 | 2.50 |
| production/C/cold-source-2-group-tree/files.read.resolve | 30 | 0.30 | 0.50 | 0.20 | 0.50 |
| production/C/cold-source-2-group-tree/files.read.read | 30 | 2.20 | 3.13 | 1.80 | 3.60 |

### User Timing

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold/files.tree.client | 10 | 3650.60 | 4722.12 | 3461.30 | 4783.50 |
| production/A/service-cold/files.tree.project | 10 | 73.15 | 79.02 | 69.60 | 79.60 |
| production/A/service-cold/files.tree.build | 10 | 9.30 | 10.45 | 8.40 | 10.50 |
| production/A/reopen/files.tree.client | 10 | 3323.95 | 3824.47 | 2888.80 | 3993.80 |
| production/A/reopen/files.tree.project | 10 | 80.35 | 88.49 | 74.70 | 90.20 |
| production/A/reopen/files.tree.build | 10 | 9.15 | 12.95 | 8.30 | 13.90 |
| production/C/cold-rich-1-group-tree/files.activation | 30 | 890.40 | 1037.81 | 867.60 | 1216.00 |
| production/C/cold-rich-1-group-tree/files.activation.read | 30 | 435.05 | 492.86 | 426.50 | 609.00 |
| production/C/cold-rich-1-group-tree/editor.session.publish | 30 | 0.10 | 0.20 | 0.00 | 0.40 |
| production/C/cold-rich-1-group-tree/editor.tiptap.create | 30 | 450.85 | 477.83 | 78.20 | 493.00 |
| production/C/cold-rich-1-group-tree/editor.tiptap.initialize | 30 | 442.85 | 471.04 | 27.60 | 484.80 |
| production/C/cold-rich-1-group-tree/editor.view.publish | 30 | 0.10 | 0.20 | 0.00 | 0.30 |
| production/C/hot-rich-1-group-tree/files.activation | 30 | 439.10 | 470.25 | 425.50 | 474.10 |
| production/C/hot-rich-1-group-tree/editor.session.publish | 30 | 0.10 | 0.16 | 0.00 | 0.20 |
| production/C/hot-rich-1-group-tree/editor.view.publish | 30 | 0.00 | 0.16 | 0.00 | 0.20 |
| production/C/hot-rich-1-group-tab/editor.session.publish | 30 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-rich-1-group-tab/files.activation | 30 | 431.10 | 443.73 | 419.90 | 452.70 |
| production/C/hot-rich-1-group-tab/editor.view.publish | 30 | 0.05 | 0.10 | 0.00 | 0.20 |
| production/C/cold-rich-2-group-tree/files.activation.read | 30 | 436.20 | 462.20 | 421.70 | 578.80 |
| production/C/cold-rich-2-group-tree/files.activation | 30 | 887.85 | 938.62 | 865.90 | 1105.40 |
| production/C/cold-rich-2-group-tree/editor.session.publish | 30 | 0.20 | 0.30 | 0.10 | 0.30 |
| production/C/cold-rich-2-group-tree/editor.tiptap.create | 30 | 451.05 | 487.92 | 442.00 | 497.90 |
| production/C/cold-rich-2-group-tree/editor.tiptap.initialize | 30 | 441.20 | 477.20 | 432.60 | 486.10 |
| production/C/cold-rich-2-group-tree/editor.view.publish | 30 | 0.10 | 0.10 | 0.00 | 0.20 |
| production/C/hot-rich-2-group-tree/editor.session.publish | 30 | 0.20 | 0.40 | 0.10 | 0.40 |
| production/C/hot-rich-2-group-tree/files.activation | 30 | 439.85 | 465.55 | 427.70 | 479.10 |
| production/C/hot-rich-2-group-tree/editor.view.publish | 30 | 0.00 | 0.10 | 0.00 | 1.70 |
| production/C/hot-rich-2-group-tab/editor.session.publish | 30 | 0.10 | 0.20 | 0.10 | 0.30 |
| production/C/hot-rich-2-group-tab/files.activation | 30 | 437.50 | 445.25 | 430.80 | 445.90 |
| production/C/hot-rich-2-group-tab/editor.view.publish | 30 | 0.10 | 0.16 | 0.00 | 0.20 |
| production/C/cold-source-1-group-tree/files.activation | 30 | 885.90 | 928.07 | 871.00 | 959.00 |
| production/C/cold-source-1-group-tree/files.activation.read | 30 | 443.75 | 475.18 | 433.00 | 509.50 |
| production/C/cold-source-1-group-tree/editor.session.publish | 30 | 0.10 | 0.20 | 0.00 | 0.30 |
| production/C/cold-source-1-group-tree/editor.monaco.mount | 30 | 442.65 | 453.09 | 188.60 | 497.90 |
| production/C/cold-source-1-group-tree/editor.monaco.model | 30 | 0.30 | 0.66 | 0.20 | 7.40 |
| production/C/cold-source-1-group-tree/editor.monaco.create | 30 | 4.25 | 7.40 | 3.40 | 157.50 |
| production/C/cold-source-1-group-tree/editor.view.publish | 30 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-source-1-group-tree/files.activation | 30 | 446.75 | 463.96 | 437.00 | 569.80 |
| production/C/hot-source-1-group-tree/editor.session.publish | 30 | 0.10 | 0.20 | 0.00 | 0.30 |
| production/C/hot-source-1-group-tree/editor.view.publish | 30 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-source-1-group-tab/editor.session.publish | 30 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-source-1-group-tab/files.activation | 30 | 445.80 | 460.02 | 432.90 | 465.10 |
| production/C/hot-source-1-group-tab/editor.view.publish | 30 | 0.00 | 0.10 | 0.00 | 0.20 |
| production/C/cold-source-2-group-tree/files.activation.read | 30 | 446.20 | 457.34 | 436.60 | 457.90 |
| production/C/cold-source-2-group-tree/files.activation | 30 | 889.40 | 911.16 | 877.60 | 921.80 |
| production/C/cold-source-2-group-tree/editor.session.publish | 30 | 0.15 | 0.20 | 0.10 | 0.30 |
| production/C/cold-source-2-group-tree/editor.monaco.mount | 30 | 444.30 | 464.88 | 436.80 | 484.50 |
| production/C/cold-source-2-group-tree/editor.monaco.model | 30 | 0.20 | 0.40 | 0.10 | 0.40 |
| production/C/cold-source-2-group-tree/editor.monaco.create | 30 | 6.30 | 7.00 | 4.20 | 10.70 |
| production/C/cold-source-2-group-tree/editor.view.publish | 30 | 0.10 | 0.10 | 0.00 | 0.20 |
| production/C/hot-source-2-group-tree/editor.session.publish | 30 | 0.20 | 0.30 | 0.10 | 0.40 |
| production/C/hot-source-2-group-tree/files.activation | 30 | 446.80 | 509.37 | 436.50 | 575.10 |
| production/C/hot-source-2-group-tree/editor.view.publish | 30 | 0.05 | 0.16 | 0.00 | 0.20 |
| production/C/hot-source-2-group-tab/editor.session.publish | 30 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-source-2-group-tab/files.activation | 30 | 445.00 | 482.23 | 430.60 | 504.60 |
| production/C/hot-source-2-group-tab/editor.view.publish | 30 | 0.10 | 0.10 | 0.00 | 0.10 |

### 各操作最长主线程任务

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold | 10 | 1980.50 | 2180.05 | 1921.00 | 2203.00 |
| production/A/reopen | 10 | 1989.50 | 2184.00 | 1884.00 | 2184.00 |
| production/B/notes-wide | 30 | 98.00 | 115.65 | 87.00 | 161.00 |
| production/C/cold-rich-1-group-tree | 30 | 877.00 | 1007.05 | 856.00 | 1220.00 |
| production/C/hot-rich-1-group-tree | 30 | 868.50 | 893.40 | 845.00 | 922.00 |
| production/C/hot-rich-1-group-tab | 30 | 860.00 | 881.60 | 840.00 | 893.00 |
| production/C/cold-rich-2-group-tree | 30 | 875.50 | 926.20 | 860.00 | 991.00 |
| production/C/hot-rich-2-group-tree | 30 | 865.50 | 894.20 | 846.00 | 913.00 |
| production/C/hot-rich-2-group-tab | 30 | 871.00 | 880.55 | 862.00 | 890.00 |
| production/C/cold-source-1-group-tree | 30 | 885.00 | 906.30 | 871.00 | 933.00 |
| production/C/hot-source-1-group-tree | 30 | 879.00 | 902.70 | 866.00 | 1122.00 |
| production/C/hot-source-1-group-tab | 30 | 883.00 | 914.55 | 871.00 | 932.00 |
| production/C/cold-source-2-group-tree | 30 | 890.50 | 918.60 | 878.00 | 928.00 |
| production/C/hot-source-2-group-tree | 30 | 877.00 | 953.60 | 865.00 | 1168.00 |
| production/C/hot-source-2-group-tab | 30 | 880.00 | 945.55 | 864.00 | 986.00 |

## 性能标准对照

采用 p95 与规范时限作对照；规范本身没有指定分位数，因此本表是报告约定，不是改写产品合同。

| 变体 | 规范时限 ms | 实测 p95 ms | 结果 |
|---|---:|---:|---|
| production/A/service-cold | 1000 | 7421.13 | p95 超出 |
| production/A/reopen | 300 | 6441.68 | p95 超出 |
| production/C/cold-rich-1-group-tree | 200 | 1710.65 | p95 超出 |
| production/C/hot-rich-1-group-tree | 100 | 1092.85 | p95 超出 |
| production/C/hot-rich-1-group-tab | 100 | 890.24 | p95 超出 |
| production/C/cold-rich-2-group-tree | 200 | 1596.26 | p95 超出 |
| production/C/hot-rich-2-group-tree | 100 | 1085.91 | p95 超出 |
| production/C/hot-rich-2-group-tab | 100 | 883.53 | p95 超出 |
| production/C/cold-source-1-group-tree | 200 | 1620.39 | p95 超出 |
| production/C/hot-source-1-group-tree | 100 | 1117.88 | p95 超出 |
| production/C/hot-source-1-group-tab | 100 | 931.44 | p95 超出 |
| production/C/cold-source-2-group-tree | 200 | 1596.82 | p95 超出 |
| production/C/hot-source-2-group-tree | 100 | 1172.85 | p95 超出 |
| production/C/hot-source-2-group-tab | 100 | 969.16 | p95 超出 |

## 测量设计与环境

- 固定种子 42017，3000 个 Markdown，5120–30720 bytes，共 52769090 bytes；root: 1 (0.03%)；lorebook: 899 (29.97%)；manuscript: 999 (33.30%)；notes: 1101 (36.70%)。普通主体目录深度 3–5 层；index.md 与宽目录是明确的浅层入口。
- 用真实 POST /api/projects 创建项目后写入返回 projectRoot 对应的隔离 State Root；项目卡片的真实 click 发起打开。rich 与 source 使用不同项目，避免旧标签与分组恢复污染。
- 起止判定：{"percentile":"线性插值，位置 (n-1)*p；仅成功且输入验证通过的样本进入统计","tree":"click 捕获事件至三个根目录已渲染、可命中，连续两个动画帧成立","directory":"直接子行全部渲染、展开动画结束，连续两个动画帧成立","editor":"当前活动组目标标签选中、正确标记出现在可见编辑器、输入可写且不 busy；连续两个动画帧成立；窗口外输入并撤销","cold":"A 每次重启服务；C 每次用该项目中从未打开的文件；不清 OS 页缓存","desktop":"桌面版未测"}。
- 样本统计保留 Resource Timing、Server-Timing、固定名字的 User Timing measure、Long Tasks、Long Animation Frames 原始条目；每个样本记录 loadAverage。常驻计时不生成 mark 或序号名字。
- 环境：{"hostname":"archlinux","platform":"linux","arch":"x64","bun":"1.4.2","cpuModel":"Intel(R) Core(TM) i5-1035G1 CPU @ 1.00GHz","cpuCount":8,"memoryBytes":16429027328,"chrome":"151.0.7922.71","loadAtStart":[0.55,0.81,0.75],"loadAtEnd":[1.28,1.27,1.22],"viewport":{"width":1440,"height":1000},"headless":true}。
- State Root：/tmp/neuro-book/t42-files-baseline-3rsG8h/state；样本、State Root 与独立 Chrome profile 已清理=true；仅超限 profiling 文件留存=[]。
- 构建日志：/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-build.log；命令与逐次服务启动日志与报告同目录。

## 跟踪与 CPU 采样

| 运行 | 采样对象 | CPU 样本数 | 分类采样 ms | 原始文件 |
|---|---|---:|---|---|
| baseline-directory-expand | browser | 490 | {"未归类 CPU":319.9709999999998,"空闲或原生未归类":17.173000000000002,"垃圾回收":133.25599999999991} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-directory-expand.cpuprofile (42985 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-directory-expand.trace.json (943340 bytes) |
| baseline-production-rich-1-group | browser | 1553 | {"未归类 CPU":1428.0249999389694,"空闲或原生未归类":113.769,"垃圾回收":10.936,"富文本控件与视图":6.479000000000001,"Monaco 模型与控件":1.091} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-production-rich-1-group.cpuprofile (173487 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-production-rich-1-group.trace.json (566263 bytes) |
| baseline-production-rich-2-group | browser | 1576 | {"未归类 CPU":1434.9149999389665,"空闲或原生未归类":99.68000000000002,"垃圾回收":16.333,"富文本控件与视图":5.736,"Monaco 模型与控件":2.136} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-production-rich-2-group.cpuprofile (165424 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-production-rich-2-group.trace.json (544812 bytes) |
| baseline-production-source-1-group | browser | 1599 | {"未归类 CPU":1467.6029999999987,"空闲或原生未归类":107.99199999999999,"垃圾回收":14.116000000000001,"Monaco 模型与控件":10.646,"富文本控件与视图":1.088,"Vue 更新":7.955} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-production-source-1-group.cpuprofile (149368 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-production-source-1-group.trace.json (612265 bytes) |
| baseline-production-source-2-group | browser | 1614 | {"未归类 CPU":1482.6230000000032,"空闲或原生未归类":97.14199999999998,"垃圾回收":16.490000000000002,"Monaco 模型与控件":6.082000000000001,"Vue 更新":7.963} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-production-source-2-group.cpuprofile (161639 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-production-source-2-group.trace.json (413659 bytes) |

服务 CPU profile 使用 Bun --cpu-prof，采样真正 .output/server/index.mjs 进程；按 performance.timeOrigin 与 startTime 对齐，只统计代表性打开窗口。parseMarkdownDocument、scanWorkspaceTree、visitPath、buildWorkspaceNode、createProjectIssues、readWorkspaceTextFile 在本次构建 AST 中以独特函数体识别，记录压缩名、行列与 matchedBy；仅唯一匹配映射参与祖先栈归类。frontmatter 优先于其外层索引栈，未归类部分保留；CPU 采样不等于异步 I/O wall-clock。
Chrome 使用 1000 µs CPU sampling 和 devtools.timeline/blink.user_timing/v8.execute trace。独立采样脚本的 files.baseline.profile-clock mark 对齐 monotonic 微秒时钟；只统计 sample click-to-ready 窗口，trace 只取同 pid/tid 页面主线程。按 parseMarkdown/createDoc/createSchema/DOMParser 归类解析与模型、EditorView/createView/updateState 归类富文本控件、Monaco model/widget/tokenizer、建树和 Vue 祖先栈归类；压缩函数名无法归类的保留未归类。Layout/UpdateLayoutTree/Paint 与 RunTask/FunctionCall 嵌套，不能相加。独立时钟 mark 会立即清理，不进入常规样本。

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

Error: development 启动失败；详见 /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-development-11.log
    at startProduct (/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/packages/neuro-book/scripts/perf/files-baseline.ts:160:19)
    at async restart (/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/packages/neuro-book/scripts/perf/files-baseline.ts:219:25)
    at async main (/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/packages/neuro-book/scripts/perf/files-baseline.ts:422:19)
    at processTicksAndRejections (native:7:39)
