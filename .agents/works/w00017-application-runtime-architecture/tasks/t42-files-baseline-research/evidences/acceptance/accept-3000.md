# Files 现状耗时基线

生成时间：2026-10-03T10:31:03.846Z；HEAD：a7346d225d48b8496078001a5ddfa656da85e827；生产镜像身份详见 JSON build.image。

完整运行：通过；有效样本 260/260。桌面版未测。

## A. 打开项目

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold | 5 | 6081.60 | 6349.82 | 5877.10 | 6392.60 |
| production/A/reopen | 5 | 5675.70 | 6171.96 | 5584.80 | 6284.80 |

服务冷开每次重启自有 Product；reopen 在同进程内关闭并再次打开。两者都会经历真实 Project Session 生命周期，OS 页缓存保持自然状态。

### 打开项目的互斥区间

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| service-cold/点击至 open 响应结束 | 5 | 514.50 | 523.56 | 505.00 | 524.00 |
| service-cold/open 响应结束至 tree 响应结束 | 5 | 3465.30 | 3676.26 | 3319.30 | 3707.70 |
| service-cold/tree 响应结束至可操作 | 5 | 2101.80 | 2164.76 | 2046.60 | 2179.90 |
| reopen/点击至 open 响应结束 | 5 | 466.60 | 504.62 | 441.70 | 512.60 |
| reopen/open 响应结束至 tree 响应结束 | 5 | 3141.90 | 3476.58 | 3032.70 | 3558.90 |
| reopen/tree 响应结束至可操作 | 5 | 2070.60 | 2229.52 | 2060.70 | 2259.30 |

三个区间在同一样本内相加等于打开总耗时；各列分位数不能相加。open 接口只等 required 模块 minimum-ready，File Index 在后台共享 warm-up，tree 请求等待完整快照。接口 wall-clock、frontmatter CPU 采样与前端 User Timing 分开解释。

### 前端投影与建树

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold/files.tree.project | 5 | 77.20 | 77.38 | 74.50 | 77.40 |
| production/A/service-cold/files.tree.build | 5 | 7.50 | 13.36 | 7.20 | 14.20 |
| production/A/reopen/files.tree.project | 5 | 76.00 | 78.54 | 74.70 | 79.10 |
| production/A/reopen/files.tree.build | 5 | 9.30 | 9.60 | 9.00 | 9.60 |

tree 响应结束至可操作还包含 JSON 解码、响应状态提交、Vue 更新、DOM 渲染和两帧确认；不能把整个残余区间标为建树或纯渲染。代表 Chrome profile 与 Layout/UpdateLayoutTree/Paint 原始跟踪见下文。

## B. 展开宽目录

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/B/notes-wide | 10 | 362.20 | 392.36 | 359.00 | 392.50 |

目录 notes/wide/ 直接包含 400 项。终点包括所有直接子行挂载与展开动画完成。最长完整 Long Task：

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/B/notes-wide | 10 | 94.00 | 113.55 | 91.00 | 114.00 |

当前服务发布完整 tree；B 是已收到快照的客户端展开，不新增按需目录协议。请求数见 JSON，不把零 tree 请求解释为已实现按需扫描。

## C. 点击至正文可编辑

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/C/cold-rich-1-group-tree | 10 | 1643.30 | 1929.06 | 1581.30 | 2073.20 |
| production/C/hot-rich-1-group-tree | 10 | 1130.60 | 1165.75 | 1097.50 | 1186.90 |
| production/C/hot-rich-1-group-tab | 10 | 942.40 | 971.40 | 914.10 | 979.50 |
| production/C/cold-rich-2-group-tree | 10 | 1614.55 | 1710.96 | 1588.80 | 1744.40 |
| production/C/hot-rich-2-group-tree | 10 | 1130.15 | 1147.54 | 1098.70 | 1154.60 |
| production/C/hot-rich-2-group-tab | 10 | 942.30 | 1032.28 | 922.90 | 1093.30 |
| production/C/cold-source-1-group-tree | 10 | 1644.75 | 1913.36 | 1600.30 | 1934.10 |
| production/C/hot-source-1-group-tree | 10 | 1152.15 | 1198.05 | 1107.20 | 1200.30 |
| production/C/hot-source-1-group-tab | 10 | 969.55 | 983.24 | 930.80 | 984.90 |
| production/C/cold-source-2-group-tree | 10 | 1615.20 | 1671.59 | 1588.70 | 1703.00 |
| production/C/hot-source-2-group-tree | 10 | 1123.65 | 1144.16 | 1100.30 | 1145.60 |
| production/C/hot-source-2-group-tab | 10 | 947.70 | 978.25 | 927.60 | 998.50 |
| development/C/cold-rich-1-group-tree | 10 | 1759.50 | 2453.37 | 1720.60 | 3006.20 |
| development/C/hot-rich-1-group-tree | 10 | 1142.15 | 1236.80 | 1121.50 | 1252.50 |
| development/C/hot-rich-1-group-tab | 10 | 941.55 | 1291.04 | 920.20 | 1529.00 |
| development/C/cold-rich-2-group-tree | 10 | 1595.90 | 1632.53 | 1575.10 | 1632.80 |
| development/C/hot-rich-2-group-tree | 10 | 1131.80 | 1169.39 | 1100.20 | 1179.20 |
| development/C/hot-rich-2-group-tab | 10 | 932.25 | 972.09 | 911.60 | 974.70 |
| development/C/cold-source-1-group-tree | 10 | 1643.95 | 1949.56 | 1616.00 | 2146.70 |
| development/C/hot-source-1-group-tree | 10 | 1177.40 | 1357.58 | 1130.90 | 1398.80 |
| development/C/hot-source-1-group-tab | 10 | 956.70 | 982.03 | 944.60 | 982.80 |
| development/C/cold-source-2-group-tree | 10 | 1656.00 | 1697.97 | 1615.30 | 1699.10 |
| development/C/hot-source-2-group-tree | 10 | 1147.10 | 1182.25 | 1136.20 | 1182.70 |
| development/C/hot-source-2-group-tab | 10 | 970.30 | 992.40 | 959.80 | 998.70 |

cold 是项目内首次打开的不同文件。hot-tree 从文件树单击两个已保留标签的文件；hot-tab 从标签按钮切换。富文本／源码、单组／双组独立记录，预热与 profiling 不进入常规统计。

热切换 160 次期间 stat/read 请求合计 0；是否重建控件由固定 User Timing measure 与独立 CPU profile 交叉核对。没有 read 请求的热标签延迟不能归因服务端读文件。

冷开 read 次数：p50=1.0，p95=1.0；stat 与 read 每次计数见下表。

### 文件请求次数（单位：次）

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/C/cold-rich-1-group-tree/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-rich-1-group-tree/read | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/hot-rich-1-group-tree/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tree/read | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tab/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tab/read | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-rich-2-group-tree/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-rich-2-group-tree/read | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/hot-rich-2-group-tree/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tree/read | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tab/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tab/read | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-source-1-group-tree/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-source-1-group-tree/read | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/hot-source-1-group-tree/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tree/read | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tab/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tab/read | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-source-2-group-tree/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-source-2-group-tree/read | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/hot-source-2-group-tree/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tree/read | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tab/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tab/read | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-rich-1-group-tree/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-rich-1-group-tree/read | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/hot-rich-1-group-tree/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-1-group-tree/read | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-1-group-tab/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-1-group-tab/read | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-rich-2-group-tree/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-rich-2-group-tree/read | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/hot-rich-2-group-tree/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-2-group-tree/read | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-2-group-tab/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-2-group-tab/read | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-source-1-group-tree/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-source-1-group-tree/read | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/hot-source-1-group-tree/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-1-group-tree/read | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-1-group-tab/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-1-group-tab/read | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-source-2-group-tree/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-source-2-group-tree/read | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/hot-source-2-group-tree/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-2-group-tree/read | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-2-group-tab/stat | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-2-group-tab/read | 10 | 0.00 | 0.00 | 0.00 | 0.00 |

### 选中与标签反馈

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/C/cold-rich-1-group-tree/selectionMs | 10 | 3.15 | 6.04 | 2.80 | 6.40 |
| production/C/cold-rich-1-group-tree/tabMs | 10 | 1604.50 | 1844.41 | 1552.00 | 2023.10 |
| production/C/hot-rich-1-group-tree/selectionMs | 10 | 3.20 | 4.85 | 2.60 | 4.90 |
| production/C/hot-rich-1-group-tree/tabMs | 10 | 1114.10 | 1148.98 | 1083.40 | 1169.50 |
| production/C/hot-rich-1-group-tab/selectionMs | 10 | 928.20 | 957.18 | 900.30 | 965.60 |
| production/C/hot-rich-1-group-tab/tabMs | 10 | 928.20 | 957.18 | 900.30 | 965.60 |
| production/C/cold-rich-2-group-tree/selectionMs | 10 | 3.65 | 5.11 | 2.80 | 5.70 |
| production/C/cold-rich-2-group-tree/tabMs | 10 | 1587.20 | 1683.39 | 1558.60 | 1720.70 |
| production/C/hot-rich-2-group-tree/selectionMs | 10 | 3.35 | 5.62 | 2.80 | 5.80 |
| production/C/hot-rich-2-group-tree/tabMs | 10 | 1119.70 | 1138.94 | 1088.80 | 1147.00 |
| production/C/hot-rich-2-group-tab/selectionMs | 10 | 933.00 | 1022.31 | 914.50 | 1082.70 |
| production/C/hot-rich-2-group-tab/tabMs | 10 | 933.00 | 1022.31 | 914.50 | 1082.70 |
| production/C/cold-source-1-group-tree/selectionMs | 10 | 4.10 | 5.42 | 3.30 | 5.60 |
| production/C/cold-source-1-group-tree/tabMs | 10 | 1602.00 | 1825.42 | 1569.00 | 1845.40 |
| production/C/hot-source-1-group-tree/selectionMs | 10 | 4.05 | 5.82 | 3.40 | 6.50 |
| production/C/hot-source-1-group-tree/tabMs | 10 | 1117.95 | 1164.27 | 1073.20 | 1168.10 |
| production/C/hot-source-1-group-tab/selectionMs | 10 | 935.95 | 951.27 | 903.70 | 951.90 |
| production/C/hot-source-1-group-tab/tabMs | 10 | 935.95 | 951.27 | 903.70 | 951.90 |
| production/C/cold-source-2-group-tree/selectionMs | 10 | 3.70 | 4.55 | 3.20 | 5.00 |
| production/C/cold-source-2-group-tree/tabMs | 10 | 1578.95 | 1634.32 | 1551.10 | 1669.60 |
| production/C/hot-source-2-group-tree/selectionMs | 10 | 3.55 | 4.99 | 3.20 | 5.80 |
| production/C/hot-source-2-group-tree/tabMs | 10 | 1094.95 | 1116.30 | 1074.10 | 1119.40 |
| production/C/hot-source-2-group-tab/selectionMs | 10 | 921.25 | 946.84 | 900.70 | 961.20 |
| production/C/hot-source-2-group-tab/tabMs | 10 | 921.25 | 946.84 | 900.70 | 961.20 |
| development/C/cold-rich-1-group-tree/selectionMs | 10 | 3.95 | 5.60 | 3.60 | 6.50 |
| development/C/cold-rich-1-group-tree/tabMs | 10 | 1706.85 | 1756.70 | 1673.90 | 1782.80 |
| development/C/hot-rich-1-group-tree/selectionMs | 10 | 3.60 | 4.42 | 3.20 | 4.60 |
| development/C/hot-rich-1-group-tree/tabMs | 10 | 1126.35 | 1219.28 | 1105.20 | 1236.60 |
| development/C/hot-rich-1-group-tab/selectionMs | 10 | 925.35 | 1270.17 | 904.80 | 1504.30 |
| development/C/hot-rich-1-group-tab/tabMs | 10 | 925.35 | 1270.17 | 904.80 | 1504.30 |
| development/C/cold-rich-2-group-tree/selectionMs | 10 | 3.30 | 5.44 | 3.00 | 5.80 |
| development/C/cold-rich-2-group-tree/tabMs | 10 | 1563.30 | 1596.23 | 1543.30 | 1597.00 |
| development/C/hot-rich-2-group-tree/selectionMs | 10 | 3.20 | 4.06 | 2.90 | 4.10 |
| development/C/hot-rich-2-group-tree/tabMs | 10 | 1120.20 | 1157.91 | 1091.10 | 1165.70 |
| development/C/hot-rich-2-group-tab/selectionMs | 10 | 922.80 | 961.40 | 901.90 | 964.10 |
| development/C/hot-rich-2-group-tab/tabMs | 10 | 922.80 | 961.40 | 901.90 | 964.10 |
| development/C/cold-source-1-group-tree/selectionMs | 10 | 4.55 | 25.01 | 4.20 | 41.30 |
| development/C/cold-source-1-group-tree/tabMs | 10 | 1599.70 | 1656.42 | 1576.40 | 1675.50 |
| development/C/hot-source-1-group-tree/selectionMs | 10 | 4.70 | 5.27 | 4.00 | 5.50 |
| development/C/hot-source-1-group-tree/tabMs | 10 | 1143.00 | 1311.28 | 1098.50 | 1343.10 |
| development/C/hot-source-1-group-tab/selectionMs | 10 | 928.50 | 951.33 | 914.10 | 954.30 |
| development/C/hot-source-1-group-tab/tabMs | 10 | 928.50 | 951.33 | 914.10 | 954.30 |
| development/C/cold-source-2-group-tree/selectionMs | 10 | 4.50 | 5.37 | 4.20 | 5.60 |
| development/C/cold-source-2-group-tree/tabMs | 10 | 1611.70 | 1657.10 | 1574.10 | 1659.30 |
| development/C/hot-source-2-group-tree/selectionMs | 10 | 4.35 | 5.99 | 4.00 | 6.80 |
| development/C/hot-source-2-group-tree/tabMs | 10 | 1114.70 | 1147.14 | 1095.80 | 1147.50 |
| development/C/hot-source-2-group-tab/selectionMs | 10 | 939.00 | 966.39 | 929.00 | 970.80 |
| development/C/hot-source-2-group-tab/tabMs | 10 | 939.00 | 966.39 | 929.00 | 970.80 |

### 互斥关键路径区间

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/C/cold-rich-1-group-tree/clickToActivation | 10 | 180.40 | 182.23 | 180.30 | 183.40 |
| production/C/cold-rich-1-group-tree/activationToReadEnd | 10 | 14.10 | 23.86 | 10.80 | 26.70 |
| production/C/cold-rich-1-group-tree/readEndToSession | 10 | 460.90 | 532.55 | 444.10 | 583.90 |
| production/C/cold-rich-1-group-tree/sessionToView | 10 | 954.00 | 1146.78 | 916.50 | 1239.30 |
| production/C/cold-rich-1-group-tree/viewToEditable | 10 | 31.55 | 47.85 | 24.80 | 51.90 |
| production/C/hot-rich-1-group-tree/clickToActivation | 10 | 180.45 | 180.50 | 180.20 | 180.50 |
| production/C/hot-rich-1-group-tree/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tree/readEndToSession | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-rich-1-group-tree/sessionToView | 10 | 459.50 | 464.07 | 443.30 | 465.20 |
| production/C/hot-rich-1-group-tree/viewToEditable | 10 | 487.70 | 526.54 | 473.40 | 545.40 |
| production/C/hot-rich-1-group-tab/clickToActivation | 10 | 0.10 | 0.26 | 0.00 | 0.30 |
| production/C/hot-rich-1-group-tab/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tab/readEndToSession | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-rich-1-group-tab/sessionToView | 10 | 457.20 | 473.12 | 441.40 | 479.20 |
| production/C/hot-rich-1-group-tab/viewToEditable | 10 | 483.40 | 503.97 | 472.60 | 513.60 |
| production/C/cold-rich-2-group-tree/clickToActivation | 10 | 180.40 | 180.50 | 180.30 | 180.50 |
| production/C/cold-rich-2-group-tree/activationToReadEnd | 10 | 15.30 | 21.66 | 10.10 | 25.30 |
| production/C/cold-rich-2-group-tree/readEndToSession | 10 | 447.15 | 492.76 | 444.30 | 512.70 |
| production/C/cold-rich-2-group-tree/sessionToView | 10 | 949.50 | 1004.90 | 927.30 | 1021.60 |
| production/C/cold-rich-2-group-tree/viewToEditable | 10 | 23.85 | 27.15 | 19.30 | 27.20 |
| production/C/hot-rich-2-group-tree/clickToActivation | 10 | 180.40 | 180.50 | 180.30 | 180.50 |
| production/C/hot-rich-2-group-tree/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tree/readEndToSession | 10 | 0.30 | 0.41 | 0.10 | 0.50 |
| production/C/hot-rich-2-group-tree/sessionToView | 10 | 460.00 | 471.78 | 442.50 | 472.10 |
| production/C/hot-rich-2-group-tree/viewToEditable | 10 | 483.75 | 504.87 | 469.70 | 506.40 |
| production/C/hot-rich-2-group-tab/clickToActivation | 10 | 0.15 | 0.20 | 0.00 | 0.20 |
| production/C/hot-rich-2-group-tab/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tab/readEndToSession | 10 | 0.20 | 0.20 | 0.00 | 0.20 |
| production/C/hot-rich-2-group-tab/sessionToView | 10 | 455.90 | 505.01 | 444.00 | 527.60 |
| production/C/hot-rich-2-group-tab/viewToEditable | 10 | 482.50 | 533.47 | 478.40 | 565.60 |
| production/C/cold-source-1-group-tree/clickToActivation | 10 | 180.95 | 182.81 | 180.40 | 183.30 |
| production/C/cold-source-1-group-tree/activationToReadEnd | 10 | 13.40 | 19.56 | 9.70 | 21.90 |
| production/C/cold-source-1-group-tree/readEndToSession | 10 | 460.75 | 518.85 | 430.20 | 519.30 |
| production/C/cold-source-1-group-tree/sessionToView | 10 | 959.00 | 1166.62 | 905.80 | 1208.60 |
| production/C/cold-source-1-group-tree/viewToEditable | 10 | 49.40 | 76.68 | 37.50 | 92.30 |
| production/C/hot-source-1-group-tree/clickToActivation | 10 | 180.35 | 184.10 | 180.30 | 184.60 |
| production/C/hot-source-1-group-tree/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tree/readEndToSession | 10 | 0.10 | 0.16 | 0.00 | 0.20 |
| production/C/hot-source-1-group-tree/sessionToView | 10 | 453.00 | 479.59 | 435.40 | 487.20 |
| production/C/hot-source-1-group-tree/viewToEditable | 10 | 510.55 | 557.75 | 491.30 | 563.60 |
| production/C/hot-source-1-group-tab/clickToActivation | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-source-1-group-tab/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tab/readEndToSession | 10 | 0.10 | 0.16 | 0.00 | 0.20 |
| production/C/hot-source-1-group-tab/sessionToView | 10 | 453.65 | 471.82 | 442.30 | 475.10 |
| production/C/hot-source-1-group-tab/viewToEditable | 10 | 503.95 | 529.15 | 488.20 | 531.80 |
| production/C/cold-source-2-group-tree/clickToActivation | 10 | 180.40 | 184.61 | 180.30 | 184.70 |
| production/C/cold-source-2-group-tree/activationToReadEnd | 10 | 11.35 | 16.42 | 9.30 | 18.00 |
| production/C/cold-source-2-group-tree/readEndToSession | 10 | 455.80 | 469.27 | 439.40 | 478.50 |
| production/C/cold-source-2-group-tree/sessionToView | 10 | 916.50 | 970.27 | 903.10 | 1002.40 |
| production/C/cold-source-2-group-tree/viewToEditable | 10 | 49.70 | 54.88 | 44.20 | 55.60 |
| production/C/hot-source-2-group-tree/clickToActivation | 10 | 180.35 | 183.06 | 180.30 | 183.60 |
| production/C/hot-source-2-group-tree/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tree/readEndToSession | 10 | 0.20 | 0.30 | 0.10 | 0.30 |
| production/C/hot-source-2-group-tree/sessionToView | 10 | 447.35 | 455.82 | 433.70 | 456.40 |
| production/C/hot-source-2-group-tree/viewToEditable | 10 | 496.75 | 512.93 | 484.20 | 515.40 |
| production/C/hot-source-2-group-tab/clickToActivation | 10 | 0.20 | 0.26 | 0.10 | 0.30 |
| production/C/hot-source-2-group-tab/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tab/readEndToSession | 10 | 0.10 | 0.21 | 0.00 | 0.30 |
| production/C/hot-source-2-group-tab/sessionToView | 10 | 454.40 | 468.92 | 434.50 | 469.10 |
| production/C/hot-source-2-group-tab/viewToEditable | 10 | 493.30 | 516.37 | 484.50 | 529.10 |
| development/C/cold-rich-1-group-tree/clickToActivation | 10 | 180.40 | 180.78 | 180.30 | 181.00 |
| development/C/cold-rich-1-group-tree/activationToReadEnd | 10 | 13.50 | 19.68 | 10.30 | 20.40 |
| development/C/cold-rich-1-group-tree/readEndToSession | 10 | 467.20 | 491.42 | 452.60 | 501.10 |
| development/C/cold-rich-1-group-tree/sessionToView | 10 | 1043.35 | 1755.72 | 1013.50 | 2312.50 |
| development/C/cold-rich-1-group-tree/viewToEditable | 10 | 44.15 | 50.06 | 39.50 | 51.50 |
| development/C/hot-rich-1-group-tree/clickToActivation | 10 | 180.40 | 180.76 | 180.30 | 180.80 |
| development/C/hot-rich-1-group-tree/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-1-group-tree/readEndToSession | 10 | 0.15 | 0.20 | 0.10 | 0.20 |
| development/C/hot-rich-1-group-tree/sessionToView | 10 | 459.90 | 506.78 | 448.70 | 513.40 |
| development/C/hot-rich-1-group-tree/viewToEditable | 10 | 500.80 | 549.52 | 486.60 | 558.70 |
| development/C/hot-rich-1-group-tab/clickToActivation | 10 | 0.10 | 0.20 | 0.10 | 0.20 |
| development/C/hot-rich-1-group-tab/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-1-group-tab/readEndToSession | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| development/C/hot-rich-1-group-tab/sessionToView | 10 | 448.40 | 576.59 | 439.30 | 632.30 |
| development/C/hot-rich-1-group-tab/viewToEditable | 10 | 490.75 | 718.88 | 478.40 | 896.40 |
| development/C/cold-rich-2-group-tree/clickToActivation | 10 | 180.45 | 183.17 | 180.20 | 184.30 |
| development/C/cold-rich-2-group-tree/activationToReadEnd | 10 | 13.15 | 20.01 | 10.40 | 20.10 |
| development/C/cold-rich-2-group-tree/readEndToSession | 10 | 448.80 | 454.06 | 437.70 | 454.10 |
| development/C/cold-rich-2-group-tree/sessionToView | 10 | 927.30 | 953.96 | 912.30 | 954.10 |
| development/C/cold-rich-2-group-tree/viewToEditable | 10 | 26.85 | 41.89 | 22.20 | 50.40 |
| development/C/hot-rich-2-group-tree/clickToActivation | 10 | 180.40 | 181.04 | 180.20 | 181.40 |
| development/C/hot-rich-2-group-tree/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-2-group-tree/readEndToSession | 10 | 0.30 | 0.30 | 0.10 | 0.30 |
| development/C/hot-rich-2-group-tree/sessionToView | 10 | 458.90 | 480.85 | 443.20 | 488.10 |
| development/C/hot-rich-2-group-tree/viewToEditable | 10 | 494.85 | 507.86 | 475.50 | 510.60 |
| development/C/hot-rich-2-group-tab/clickToActivation | 10 | 0.20 | 0.20 | 0.10 | 0.20 |
| development/C/hot-rich-2-group-tab/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-2-group-tab/readEndToSession | 10 | 0.10 | 0.20 | 0.10 | 0.20 |
| development/C/hot-rich-2-group-tab/sessionToView | 10 | 448.45 | 479.02 | 438.30 | 483.70 |
| development/C/hot-rich-2-group-tab/viewToEditable | 10 | 481.35 | 504.25 | 472.60 | 506.90 |
| development/C/cold-source-1-group-tree/clickToActivation | 10 | 180.55 | 201.94 | 180.30 | 216.30 |
| development/C/cold-source-1-group-tree/activationToReadEnd | 10 | 12.90 | 15.36 | 10.60 | 15.50 |
| development/C/cold-source-1-group-tree/readEndToSession | 10 | 458.90 | 493.13 | 451.30 | 503.30 |
| development/C/cold-source-1-group-tree/sessionToView | 10 | 936.65 | 1175.66 | 921.50 | 1346.30 |
| development/C/cold-source-1-group-tree/viewToEditable | 10 | 51.50 | 94.47 | 41.00 | 99.60 |
| development/C/hot-source-1-group-tree/clickToActivation | 10 | 180.35 | 180.46 | 180.20 | 180.50 |
| development/C/hot-source-1-group-tree/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-1-group-tree/readEndToSession | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| development/C/hot-source-1-group-tree/sessionToView | 10 | 482.25 | 535.70 | 442.80 | 547.40 |
| development/C/hot-source-1-group-tree/viewToEditable | 10 | 536.75 | 641.38 | 503.40 | 670.90 |
| development/C/hot-source-1-group-tab/clickToActivation | 10 | 0.20 | 0.20 | 0.10 | 0.20 |
| development/C/hot-source-1-group-tab/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-1-group-tab/readEndToSession | 10 | 0.00 | 0.10 | 0.00 | 0.10 |
| development/C/hot-source-1-group-tab/sessionToView | 10 | 450.40 | 460.09 | 443.50 | 461.40 |
| development/C/hot-source-1-group-tab/viewToEditable | 10 | 507.20 | 525.00 | 492.60 | 526.80 |
| development/C/cold-source-2-group-tree/clickToActivation | 10 | 181.75 | 183.82 | 180.30 | 184.00 |
| development/C/cold-source-2-group-tree/activationToReadEnd | 10 | 12.55 | 16.10 | 10.40 | 17.50 |
| development/C/cold-source-2-group-tree/readEndToSession | 10 | 457.90 | 479.44 | 443.50 | 486.50 |
| development/C/cold-source-2-group-tree/sessionToView | 10 | 940.05 | 977.29 | 913.40 | 993.00 |
| development/C/cold-source-2-group-tree/viewToEditable | 10 | 55.40 | 59.56 | 47.90 | 59.70 |
| development/C/hot-source-2-group-tree/clickToActivation | 10 | 183.25 | 184.07 | 180.40 | 184.20 |
| development/C/hot-source-2-group-tree/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-2-group-tree/readEndToSession | 10 | 0.20 | 0.30 | 0.10 | 0.30 |
| development/C/hot-source-2-group-tree/sessionToView | 10 | 451.75 | 477.84 | 442.20 | 484.00 |
| development/C/hot-source-2-group-tree/viewToEditable | 10 | 512.95 | 533.33 | 501.40 | 543.10 |
| development/C/hot-source-2-group-tab/clickToActivation | 10 | 0.20 | 0.25 | 0.10 | 0.30 |
| development/C/hot-source-2-group-tab/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-2-group-tab/readEndToSession | 10 | 0.15 | 0.20 | 0.00 | 0.20 |
| development/C/hot-source-2-group-tab/sessionToView | 10 | 458.05 | 467.78 | 441.80 | 472.60 |
| development/C/hot-source-2-group-tab/viewToEditable | 10 | 519.00 | 529.49 | 500.00 | 532.50 |

这些区间按时间线单调切分，相加等于该操作总耗时。无 read 的 hot 样本不虚构网络阶段。控件与解析 measure 是嵌套子阶段，不能再次相加。

files.activation.read 虽然只包 read await，仍包含主线程排队、响应解码与 Promise continuation；与 Resource Timing 读请求时长不同。TipTap initialize 是解析/模型/控件与 onCreate 调度联合区间；Monaco mount 包括模块等待、nextTick/layout。它们不能解释成纯解析或纯创建。

## D. 约 0.3 秒延迟

生产常规 C 样本未出现 250–400 ms 操作；开发对照是否完成见下文，不把较慢或较快操作自动称为约 0.3 秒复现。

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| 生产 250–400 ms 样本 | 0 | 未取得 | 未取得 | 未取得 | 未取得 |

代表样本：未取得。

| 区间 | 耗时 ms |
|---|---:|

开发模式对照：完整完成，与生产使用同一参数、不同合成项目；结果在 C 表中。

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| 开发 250–400 ms 样本 | 0 | 未取得 | 未取得 | 未取得 | 未取得 |

开发代表样本：未取得。

| 区间 | 耗时 ms |
|---|---:|

本轮全部生产 C 的范围为 914.10–2073.20 ms；开发 C 为 911.60–3006.20 ms。未命中 250–400 ms 时，D 的 count=0、分位数为空，保留该结果，不用 B 的展开时长或小规模试跑代替正式切换。

## 与 t16、t24 的可比性

t16/t24 在 Windows、Chromium 151.0.7922.34、Source Dev、1440×1000 下测两个 8 KiB permanent 标签，3×30 次；t24 富文本单组 p50/p95=33.5/38.0 ms，源码单组=43.5/53.8 ms。本轮是 Linux、headless Chrome、生产构建、约 3000 个 5–30 KiB 文件，每格 30 次，输入证明逐样本进行。视口和 capture-click 起点相同，但构建、平台、文件大小、工程规模与跨帧终点不同，不能直接计算回归幅度。

仅 hot-tab 的入口与历史标签切换对应；hot-tree 保留既有 180 ms 单击等待，不与 t24 标签值直接比较。双组 hot-tab 也保留为补充，本轮要求的单组富文本／源码两格均有独立样本。

## 网络与阶段分解

### 每次操作请求总数（单位：次）

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold | 5 | 47.00 | 48.60 | 47.00 | 49.00 |
| production/A/reopen | 5 | 46.00 | 46.00 | 46.00 | 46.00 |
| production/B/notes-wide | 10 | 2.00 | 3.00 | 2.00 | 3.00 |
| production/C/cold-rich-1-group-tree | 10 | 4.00 | 7.55 | 3.00 | 8.00 |
| production/C/hot-rich-1-group-tree | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/hot-rich-1-group-tab | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/cold-rich-2-group-tree | 10 | 3.00 | 5.10 | 2.00 | 6.00 |
| production/C/hot-rich-2-group-tree | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/hot-rich-2-group-tab | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/cold-source-1-group-tree | 10 | 3.00 | 5.00 | 2.00 | 5.00 |
| production/C/hot-source-1-group-tree | 10 | 2.00 | 2.55 | 1.00 | 3.00 |
| production/C/hot-source-1-group-tab | 10 | 1.00 | 2.55 | 1.00 | 3.00 |
| production/C/cold-source-2-group-tree | 10 | 4.00 | 6.65 | 2.00 | 8.00 |
| production/C/hot-source-2-group-tree | 10 | 2.00 | 4.10 | 1.00 | 5.00 |
| production/C/hot-source-2-group-tab | 10 | 1.00 | 2.00 | 1.00 | 2.00 |
| development/C/cold-rich-1-group-tree | 10 | 3.50 | 11.85 | 3.00 | 15.00 |
| development/C/hot-rich-1-group-tree | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/hot-rich-1-group-tab | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/cold-rich-2-group-tree | 10 | 3.00 | 5.20 | 2.00 | 7.00 |
| development/C/hot-rich-2-group-tree | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/hot-rich-2-group-tab | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/cold-source-1-group-tree | 10 | 3.00 | 7.30 | 2.00 | 10.00 |
| development/C/hot-source-1-group-tree | 10 | 1.50 | 2.55 | 1.00 | 3.00 |
| development/C/hot-source-1-group-tab | 10 | 1.00 | 2.00 | 1.00 | 2.00 |
| development/C/cold-source-2-group-tree | 10 | 3.00 | 5.10 | 2.00 | 6.00 |
| development/C/hot-source-2-group-tree | 10 | 2.00 | 2.00 | 1.00 | 2.00 |
| development/C/hot-source-2-group-tab | 10 | 1.00 | 2.00 | 1.00 | 2.00 |

### 每个请求耗时

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 5 | 7.00 | 8.18 | 6.80 | 8.40 |
| production/A/service-cold//api/config/bootstrap | 15 | 13.20 | 25.34 | 6.60 | 28.00 |
| production/A/service-cold//api/projects/open | 5 | 471.00 | 476.26 | 464.50 | 476.70 |
| production/A/service-cold//api/storage/user/context | 21 | 27.60 | 35.60 | 9.60 | 36.80 |
| production/A/service-cold//favicon.ico | 5 | 15.70 | 20.96 | 14.40 | 21.80 |
| production/A/service-cold//api/storage/user/action | 91 | 26.30 | 283.80 | 10.60 | 307.90 |
| production/A/service-cold//api/projects | 5 | 23.10 | 30.06 | 8.30 | 30.60 |
| production/A/service-cold//api/workspace-files/tree | 5 | 3436.60 | 3648.10 | 3280.20 | 3678.90 |
| production/A/service-cold//api/storage/project/context | 10 | 50.35 | 54.73 | 45.10 | 55.00 |
| production/A/service-cold//api/storage/project/action | 75 | 21.50 | 51.21 | 9.20 | 73.90 |
| production/A/reopen//api/auth/me | 5 | 8.90 | 15.56 | 7.50 | 15.70 |
| production/A/reopen//api/config/bootstrap | 15 | 15.80 | 21.01 | 6.90 | 25.00 |
| production/A/reopen//api/projects/open | 5 | 418.40 | 445.58 | 399.70 | 450.70 |
| production/A/reopen//api/storage/user/context | 20 | 23.40 | 27.08 | 18.70 | 28.50 |
| production/A/reopen//favicon.ico | 5 | 14.90 | 18.58 | 13.70 | 19.10 |
| production/A/reopen//api/storage/user/action | 90 | 30.95 | 391.37 | 13.00 | 415.40 |
| production/A/reopen//api/projects | 5 | 8.90 | 17.24 | 7.10 | 19.30 |
| production/A/reopen//api/workspace-files/tree | 5 | 3120.30 | 3455.42 | 3011.20 | 3537.90 |
| production/A/reopen//api/storage/project/context | 10 | 26.05 | 27.32 | 24.40 | 27.50 |
| production/A/reopen//api/storage/project/action | 70 | 25.75 | 52.45 | 10.30 | 56.60 |
| production/B/notes-wide//api/storage/user/action | 20 | 10.60 | 16.64 | 7.90 | 17.30 |
| production/B/notes-wide//api/storage/project/action | 2 | 9.25 | 10.20 | 8.20 | 10.30 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 10 | 13.20 | 23.48 | 10.10 | 26.40 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 9 | 17.40 | 29.92 | 13.10 | 34.80 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 14.80 | 14.80 | 14.80 | 14.80 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 13.80 | 13.80 | 13.80 | 13.80 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 26 | 17.25 | 33.23 | 9.40 | 34.30 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 10 | 18.35 | 23.39 | 15.00 | 23.80 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 10 | 16.50 | 19.19 | 13.30 | 20.00 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 10 | 14.75 | 21.11 | 9.90 | 24.80 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 21 | 15.40 | 21.30 | 9.20 | 49.10 |
| production/C/cold-rich-2-group-tree//api/storage/user/action | 1 | 22.50 | 22.50 | 22.50 | 22.50 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 10 | 16.60 | 21.42 | 13.30 | 22.50 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 10 | 16.60 | 23.02 | 13.70 | 26.80 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 10 | 12.95 | 18.34 | 9.40 | 20.00 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 18 | 16.80 | 23.34 | 10.00 | 29.80 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 15.50 | 15.50 | 15.50 | 15.50 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 9.10 | 9.10 | 9.10 | 9.10 |
| production/C/cold-source-1-group-tree//_nuxt/editor.worker-CdQrwHl8.js | 1 | -4.00 | -4.00 | -4.00 | -4.00 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 17 | 14.60 | 19.94 | 8.40 | 20.90 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 15 | 13.70 | 16.46 | 8.40 | 16.60 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 10 | 10.90 | 16.07 | 9.00 | 17.60 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 28 | 14.10 | 17.87 | 8.10 | 28.60 |
| production/C/cold-source-2-group-tree//api/storage/user/action | 4 | 21.55 | 23.94 | 20.50 | 24.30 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 16 | 15.05 | 18.52 | 10.20 | 19.50 |
| production/C/hot-source-2-group-tree//api/storage/user/action | 4 | 24.35 | 31.07 | 23.60 | 32.20 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 12 | 14.50 | 18.19 | 11.00 | 20.50 |
| development/C/cold-rich-1-group-tree//api/storage/user/action | 9 | 22.80 | 79.32 | 12.10 | 111.60 |
| development/C/cold-rich-1-group-tree//api/workspace-files/read | 10 | 13.10 | 19.13 | 9.80 | 19.80 |
| development/C/cold-rich-1-group-tree//api/storage/project/action | 31 | 19.50 | 617.30 | 10.70 | 1116.20 |
| development/C/cold-rich-1-group-tree//_nuxt/components/editor-workbench/MarkdownEditorView.vue | 2 | 557.15 | 1001.07 | 63.90 | 1050.40 |
| development/C/cold-rich-1-group-tree//_nuxt/__uno.css | 1 | 1066.70 | 1066.70 | 1066.70 | 1066.70 |
| development/C/cold-rich-1-group-tree//_nuxt/components/markdown-studio/MarkdownCommentFlowPanel.vue | 1 | 1046.50 | 1046.50 | 1046.50 | 1046.50 |
| development/C/cold-rich-1-group-tree//_nuxt/composables/useMarkdownEditorController.ts | 1 | 1046.70 | 1046.70 | 1046.70 | 1046.70 |
| development/C/hot-rich-1-group-tree//api/storage/project/action | 10 | 18.15 | 26.10 | 15.20 | 27.90 |
| development/C/hot-rich-1-group-tab//api/storage/project/action | 10 | 18.00 | 39.75 | 15.40 | 54.60 |
| development/C/cold-rich-2-group-tree//api/workspace-files/read | 10 | 12.45 | 19.53 | 10.10 | 19.80 |
| development/C/cold-rich-2-group-tree//api/storage/project/action | 20 | 15.00 | 20.87 | 9.20 | 24.20 |
| development/C/cold-rich-2-group-tree//api/storage/user/action | 3 | 23.70 | 24.06 | 23.40 | 24.10 |
| development/C/hot-rich-2-group-tree//api/storage/project/action | 10 | 16.90 | 20.68 | 14.70 | 21.90 |
| development/C/hot-rich-2-group-tab//api/storage/project/action | 10 | 15.60 | 18.08 | 14.30 | 19.70 |
| development/C/cold-source-1-group-tree//api/storage/user/action | 5 | 24.30 | 33.98 | 15.70 | 34.10 |
| development/C/cold-source-1-group-tree//api/workspace-files/read | 10 | 12.35 | 14.82 | 10.30 | 15.00 |
| development/C/cold-source-1-group-tree//api/storage/project/action | 21 | 15.30 | 25.10 | 9.60 | 35.00 |
| development/C/cold-source-1-group-tree//_nuxt/components/editor-workbench/CodeEditorView.vue | 1 | 41.40 | 41.40 | 41.40 | 41.40 |
| development/C/hot-source-1-group-tree//api/storage/project/action | 16 | 16.10 | 19.23 | 10.60 | 20.20 |
| development/C/hot-source-1-group-tab//api/storage/project/action | 14 | 16.05 | 18.58 | 9.70 | 20.40 |
| development/C/cold-source-2-group-tree//api/workspace-files/read | 10 | 11.90 | 15.29 | 9.80 | 16.50 |
| development/C/cold-source-2-group-tree//api/storage/project/action | 23 | 13.90 | 18.65 | 8.70 | 19.00 |
| development/C/cold-source-2-group-tree//api/storage/user/action | 1 | 17.10 | 17.10 | 17.10 | 17.10 |
| development/C/hot-source-2-group-tree//api/storage/project/action | 16 | 15.00 | 18.65 | 9.40 | 20.90 |
| development/C/hot-source-2-group-tree//api/storage/user/action | 1 | 21.90 | 21.90 | 21.90 | 21.90 |
| development/C/hot-source-2-group-tab//api/storage/project/action | 13 | 15.60 | 27.86 | 9.70 | 34.70 |

### 每个请求响应体大小（单位：bytes，encodedBodySize）

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 5 | 113.00 | 113.00 | 113.00 | 113.00 |
| production/A/service-cold//api/config/bootstrap | 15 | 302.00 | 302.00 | 301.00 | 302.00 |
| production/A/service-cold//api/projects/open | 5 | 275.00 | 275.00 | 275.00 | 275.00 |
| production/A/service-cold//api/storage/user/context | 21 | 17.00 | 80.00 | 17.00 | 80.00 |
| production/A/service-cold//favicon.ico | 5 | 78.00 | 78.00 | 78.00 | 78.00 |
| production/A/service-cold//api/storage/user/action | 91 | 98.00 | 98.00 | 48.00 | 104.00 |
| production/A/service-cold//api/projects | 5 | 210.00 | 210.00 | 210.00 | 210.00 |
| production/A/service-cold//api/workspace-files/tree | 5 | 4402531.00 | 4402531.00 | 4402531.00 | 4402531.00 |
| production/A/service-cold//api/storage/project/context | 10 | 80.00 | 80.00 | 80.00 | 80.00 |
| production/A/service-cold//api/storage/project/action | 75 | 98.00 | 104.00 | 48.00 | 104.00 |
| production/A/reopen//api/auth/me | 5 | 113.00 | 113.00 | 113.00 | 113.00 |
| production/A/reopen//api/config/bootstrap | 15 | 302.00 | 302.00 | 301.00 | 302.00 |
| production/A/reopen//api/projects/open | 5 | 275.00 | 275.00 | 275.00 | 275.00 |
| production/A/reopen//api/storage/user/context | 20 | 48.50 | 80.00 | 17.00 | 80.00 |
| production/A/reopen//favicon.ico | 5 | 78.00 | 78.00 | 78.00 | 78.00 |
| production/A/reopen//api/storage/user/action | 90 | 98.00 | 98.00 | 48.00 | 98.00 |
| production/A/reopen//api/projects | 5 | 210.00 | 210.00 | 210.00 | 210.00 |
| production/A/reopen//api/workspace-files/tree | 5 | 4402531.00 | 4402531.00 | 4402531.00 | 4402531.00 |
| production/A/reopen//api/storage/project/context | 10 | 80.00 | 80.00 | 80.00 | 80.00 |
| production/A/reopen//api/storage/project/action | 70 | 98.00 | 343.00 | 48.00 | 343.00 |
| production/B/notes-wide//api/storage/user/action | 20 | 147.50 | 191.00 | 104.00 | 191.00 |
| production/B/notes-wide//api/storage/project/action | 2 | 98.00 | 98.00 | 98.00 | 98.00 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 10 | 14265.50 | 26211.30 | 5519.00 | 26556.00 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 9 | 98.00 | 191.00 | 98.00 | 191.00 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 9845.00 | 9845.00 | 9845.00 | 9845.00 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 184.00 | 184.00 | 184.00 | 184.00 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 26 | 104.00 | 446.00 | 98.00 | 446.00 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 10 | 104.00 | 104.00 | 104.00 | 104.00 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 10 | 104.00 | 104.00 | 104.00 | 104.00 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 10 | 21016.00 | 30684.35 | 6639.00 | 30719.00 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 21 | 104.00 | 1007.00 | 98.00 | 1007.00 |
| production/C/cold-rich-2-group-tree//api/storage/user/action | 1 | 98.00 | 98.00 | 98.00 | 98.00 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 10 | 104.00 | 104.00 | 104.00 | 104.00 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 10 | 104.00 | 104.00 | 104.00 | 104.00 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 10 | 14267.50 | 26213.30 | 5523.00 | 26558.00 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 18 | 104.00 | 446.00 | 98.00 | 446.00 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 2210.00 | 2210.00 | 2210.00 | 2210.00 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 3650.00 | 3650.00 | 3650.00 | 3650.00 |
| production/C/cold-source-1-group-tree//_nuxt/editor.worker-CdQrwHl8.js | 1 | 251810.00 | 251810.00 | 251810.00 | 251810.00 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 17 | 104.00 | 529.00 | 98.00 | 529.00 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 15 | 104.00 | 529.00 | 98.00 | 529.00 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 10 | 21018.00 | 30685.90 | 6641.00 | 30721.00 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 28 | 104.00 | 1007.00 | 98.00 | 1007.00 |
| production/C/cold-source-2-group-tree//api/storage/user/action | 4 | 98.00 | 177.05 | 98.00 | 191.00 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 16 | 104.00 | 1090.00 | 98.00 | 1090.00 |
| production/C/hot-source-2-group-tree//api/storage/user/action | 4 | 98.00 | 177.05 | 98.00 | 191.00 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 12 | 104.00 | 547.70 | 98.00 | 1090.00 |
| development/C/cold-rich-1-group-tree//api/storage/user/action | 9 | 286.00 | 286.00 | 143.00 | 286.00 |
| development/C/cold-rich-1-group-tree//api/workspace-files/read | 10 | 14291.50 | 26237.30 | 5547.00 | 26582.00 |
| development/C/cold-rich-1-group-tree//api/storage/project/action | 31 | 143.00 | 825.00 | 128.00 | 825.00 |
| development/C/cold-rich-1-group-tree//_nuxt/components/editor-workbench/MarkdownEditorView.vue | 2 | 18423.50 | 23666.45 | 12598.00 | 24249.00 |
| development/C/cold-rich-1-group-tree//_nuxt/__uno.css | 1 | 6839854.00 | 6839854.00 | 6839854.00 | 6839854.00 |
| development/C/cold-rich-1-group-tree//_nuxt/components/markdown-studio/MarkdownCommentFlowPanel.vue | 1 | 25826.00 | 25826.00 | 25826.00 | 25826.00 |
| development/C/cold-rich-1-group-tree//_nuxt/composables/useMarkdownEditorController.ts | 1 | 4205.00 | 4205.00 | 4205.00 | 4205.00 |
| development/C/hot-rich-1-group-tree//api/storage/project/action | 10 | 128.00 | 128.00 | 128.00 | 128.00 |
| development/C/hot-rich-1-group-tab//api/storage/project/action | 10 | 128.00 | 128.00 | 128.00 | 128.00 |
| development/C/cold-rich-2-group-tree//api/workspace-files/read | 10 | 21042.00 | 30710.35 | 6665.00 | 30745.00 |
| development/C/cold-rich-2-group-tree//api/storage/project/action | 20 | 135.50 | 2116.00 | 128.00 | 2116.00 |
| development/C/cold-rich-2-group-tree//api/storage/user/action | 3 | 143.00 | 271.70 | 143.00 | 286.00 |
| development/C/hot-rich-2-group-tree//api/storage/project/action | 10 | 128.00 | 128.00 | 128.00 | 128.00 |
| development/C/hot-rich-2-group-tab//api/storage/project/action | 10 | 128.00 | 128.00 | 128.00 | 128.00 |
| development/C/cold-source-1-group-tree//api/storage/user/action | 5 | 143.00 | 286.00 | 143.00 | 286.00 |
| development/C/cold-source-1-group-tree//api/workspace-files/read | 10 | 14293.00 | 26238.85 | 5549.00 | 26584.00 |
| development/C/cold-source-1-group-tree//api/storage/project/action | 21 | 143.00 | 825.00 | 128.00 | 825.00 |
| development/C/cold-source-1-group-tree//_nuxt/components/editor-workbench/CodeEditorView.vue | 1 | 16435.00 | 16435.00 | 16435.00 | 16435.00 |
| development/C/hot-source-1-group-tree//api/storage/project/action | 16 | 128.00 | 998.00 | 128.00 | 998.00 |
| development/C/hot-source-1-group-tab//api/storage/project/action | 14 | 128.00 | 998.00 | 128.00 | 998.00 |
| development/C/cold-source-2-group-tree//api/workspace-files/read | 10 | 21044.00 | 30712.35 | 6667.00 | 30747.00 |
| development/C/cold-source-2-group-tree//api/storage/project/action | 23 | 143.00 | 2116.00 | 128.00 | 2116.00 |
| development/C/cold-source-2-group-tree//api/storage/user/action | 1 | 143.00 | 143.00 | 143.00 | 143.00 |
| development/C/hot-source-2-group-tree//api/storage/project/action | 16 | 128.00 | 2289.00 | 128.00 | 2289.00 |
| development/C/hot-source-2-group-tree//api/storage/user/action | 1 | 143.00 | 143.00 | 143.00 | 143.00 |
| development/C/hot-source-2-group-tab//api/storage/project/action | 13 | 128.00 | 2289.00 | 128.00 | 2289.00 |

### 首字节等待（服务执行与排队均在此内）

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 5 | 5.70 | 6.86 | 5.50 | 7.10 |
| production/A/service-cold//api/config/bootstrap | 15 | 11.70 | 23.47 | 5.10 | 26.20 |
| production/A/service-cold//api/projects/open | 5 | 469.20 | 474.48 | 463.10 | 474.90 |
| production/A/service-cold//api/storage/user/context | 21 | 25.30 | 34.00 | 8.10 | 34.90 |
| production/A/service-cold//favicon.ico | 5 | 14.30 | 19.18 | 13.10 | 19.90 |
| production/A/service-cold//api/storage/user/action | 91 | 24.20 | 279.75 | 9.10 | 304.50 |
| production/A/service-cold//api/projects | 5 | 19.70 | 27.04 | 6.30 | 28.30 |
| production/A/service-cold//api/workspace-files/tree | 5 | 3424.00 | 3633.50 | 3266.80 | 3664.30 |
| production/A/service-cold//api/storage/project/context | 10 | 48.20 | 52.81 | 42.00 | 52.90 |
| production/A/service-cold//api/storage/project/action | 75 | 20.00 | 44.93 | 8.00 | 71.50 |
| production/A/reopen//api/auth/me | 5 | 7.00 | 14.16 | 5.90 | 14.30 |
| production/A/reopen//api/config/bootstrap | 15 | 14.00 | 18.95 | 5.30 | 21.40 |
| production/A/reopen//api/projects/open | 5 | 417.10 | 444.28 | 398.20 | 449.40 |
| production/A/reopen//api/storage/user/context | 20 | 21.05 | 24.81 | 17.20 | 26.90 |
| production/A/reopen//favicon.ico | 5 | 13.40 | 16.24 | 12.40 | 16.60 |
| production/A/reopen//api/storage/user/action | 90 | 27.75 | 387.91 | 11.20 | 412.80 |
| production/A/reopen//api/projects | 5 | 7.20 | 14.38 | 5.70 | 16.10 |
| production/A/reopen//api/workspace-files/tree | 5 | 3107.20 | 3441.30 | 2998.90 | 3523.50 |
| production/A/reopen//api/storage/project/context | 10 | 23.70 | 25.22 | 21.80 | 25.40 |
| production/A/reopen//api/storage/project/action | 70 | 22.65 | 50.58 | 9.00 | 55.00 |
| production/B/notes-wide//api/storage/user/action | 20 | 9.20 | 15.23 | 6.70 | 15.80 |
| production/B/notes-wide//api/storage/project/action | 2 | 7.85 | 8.61 | 7.00 | 8.70 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 10 | 11.10 | 21.29 | 8.30 | 24.40 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 9 | 15.80 | 26.72 | 11.70 | 31.20 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 12.00 | 12.00 | 12.00 | 12.00 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 12.50 | 12.50 | 12.50 | 12.50 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 26 | 15.55 | 31.20 | 8.20 | 31.80 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 10 | 16.95 | 21.99 | 13.70 | 22.40 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 10 | 15.00 | 17.80 | 11.50 | 18.70 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 10 | 12.55 | 19.34 | 8.20 | 22.90 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 21 | 13.90 | 19.80 | 8.00 | 47.60 |
| production/C/cold-rich-2-group-tree//api/storage/user/action | 1 | 19.50 | 19.50 | 19.50 | 19.50 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 10 | 15.25 | 20.06 | 11.90 | 21.10 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 10 | 15.20 | 21.41 | 12.30 | 25.10 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 10 | 11.05 | 16.57 | 7.60 | 18.10 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 18 | 15.30 | 21.97 | 8.60 | 28.60 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 14.10 | 14.10 | 14.10 | 14.10 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 7.50 | 7.50 | 7.50 | 7.50 |
| production/C/cold-source-1-group-tree//_nuxt/editor.worker-CdQrwHl8.js | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 17 | 13.20 | 18.50 | 7.10 | 18.90 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 15 | 12.10 | 15.03 | 7.20 | 15.10 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 10 | 8.90 | 14.37 | 7.40 | 15.90 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 28 | 12.60 | 16.33 | 6.70 | 27.30 |
| production/C/cold-source-2-group-tree//api/storage/user/action | 4 | 19.30 | 21.19 | 19.00 | 21.50 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 16 | 13.60 | 16.85 | 8.60 | 17.90 |
| production/C/hot-source-2-group-tree//api/storage/user/action | 4 | 21.00 | 27.25 | 20.60 | 28.30 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 12 | 13.20 | 16.85 | 8.90 | 19.00 |
| development/C/cold-rich-1-group-tree//api/storage/user/action | 9 | 20.90 | 42.38 | 10.90 | 51.10 |
| development/C/cold-rich-1-group-tree//api/workspace-files/read | 10 | 11.45 | 16.87 | 8.10 | 17.50 |
| development/C/cold-rich-1-group-tree//api/storage/project/action | 31 | 17.80 | 93.40 | 9.30 | 1111.10 |
| development/C/cold-rich-1-group-tree//_nuxt/components/editor-workbench/MarkdownEditorView.vue | 2 | 31.60 | 59.23 | 0.90 | 62.30 |
| development/C/cold-rich-1-group-tree//_nuxt/__uno.css | 1 | 1011.10 | 1011.10 | 1011.10 | 1011.10 |
| development/C/cold-rich-1-group-tree//_nuxt/components/markdown-studio/MarkdownCommentFlowPanel.vue | 1 | 1040.00 | 1040.00 | 1040.00 | 1040.00 |
| development/C/cold-rich-1-group-tree//_nuxt/composables/useMarkdownEditorController.ts | 1 | 1040.90 | 1040.90 | 1040.90 | 1040.90 |
| development/C/hot-rich-1-group-tree//api/storage/project/action | 10 | 16.55 | 24.11 | 13.90 | 25.60 |
| development/C/hot-rich-1-group-tab//api/storage/project/action | 10 | 16.55 | 36.29 | 13.70 | 49.70 |
| development/C/cold-rich-2-group-tree//api/workspace-files/read | 10 | 9.75 | 16.71 | 8.40 | 17.20 |
| development/C/cold-rich-2-group-tree//api/storage/project/action | 20 | 13.50 | 19.67 | 7.90 | 22.80 |
| development/C/cold-rich-2-group-tree//api/storage/user/action | 3 | 22.10 | 22.19 | 21.80 | 22.20 |
| development/C/hot-rich-2-group-tree//api/storage/project/action | 10 | 15.30 | 19.47 | 13.30 | 20.60 |
| development/C/hot-rich-2-group-tab//api/storage/project/action | 10 | 14.20 | 16.69 | 13.20 | 18.40 |
| development/C/cold-source-1-group-tree//api/storage/user/action | 5 | 13.50 | 20.74 | 9.70 | 21.70 |
| development/C/cold-source-1-group-tree//api/workspace-files/read | 10 | 10.55 | 12.86 | 8.70 | 12.90 |
| development/C/cold-source-1-group-tree//api/storage/project/action | 21 | 13.90 | 23.10 | 8.20 | 33.70 |
| development/C/cold-source-1-group-tree//_nuxt/components/editor-workbench/CodeEditorView.vue | 1 | 39.00 | 39.00 | 39.00 | 39.00 |
| development/C/hot-source-1-group-tree//api/storage/project/action | 16 | 14.60 | 17.78 | 9.30 | 18.60 |
| development/C/hot-source-1-group-tab//api/storage/project/action | 14 | 14.35 | 17.21 | 8.10 | 18.90 |
| development/C/cold-source-2-group-tree//api/workspace-files/read | 10 | 10.05 | 13.47 | 8.20 | 14.60 |
| development/C/cold-source-2-group-tree//api/storage/project/action | 23 | 12.30 | 16.88 | 7.40 | 17.80 |
| development/C/cold-source-2-group-tree//api/storage/user/action | 1 | 15.60 | 15.60 | 15.60 | 15.60 |
| development/C/hot-source-2-group-tree//api/storage/project/action | 16 | 13.60 | 17.28 | 8.20 | 19.60 |
| development/C/hot-source-2-group-tree//api/storage/user/action | 1 | 19.80 | 19.80 | 19.80 | 19.80 |
| development/C/hot-source-2-group-tab//api/storage/project/action | 13 | 14.40 | 26.22 | 8.00 | 33.00 |

### 响应体传输

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 5 | 0.80 | 0.90 | 0.80 | 0.90 |
| production/A/service-cold//api/config/bootstrap | 15 | 1.10 | 1.30 | 1.00 | 1.30 |
| production/A/service-cold//api/projects/open | 5 | 1.00 | 1.28 | 0.80 | 1.30 |
| production/A/service-cold//api/storage/user/context | 21 | 1.00 | 1.90 | 0.80 | 1.90 |
| production/A/service-cold//favicon.ico | 5 | 0.90 | 1.14 | 0.80 | 1.20 |
| production/A/service-cold//api/storage/user/action | 91 | 1.80 | 3.95 | 0.80 | 5.70 |
| production/A/service-cold//api/projects | 5 | 1.80 | 2.20 | 1.20 | 2.20 |
| production/A/service-cold//api/workspace-files/tree | 5 | 12.80 | 13.82 | 11.90 | 14.00 |
| production/A/service-cold//api/storage/project/context | 10 | 1.50 | 3.09 | 1.00 | 3.90 |
| production/A/service-cold//api/storage/project/action | 75 | 1.10 | 2.76 | 0.70 | 5.60 |
| production/A/reopen//api/auth/me | 5 | 0.90 | 1.16 | 0.80 | 1.20 |
| production/A/reopen//api/config/bootstrap | 15 | 1.20 | 1.95 | 0.80 | 3.00 |
| production/A/reopen//api/projects/open | 5 | 0.90 | 0.98 | 0.80 | 1.00 |
| production/A/reopen//api/storage/user/context | 20 | 1.10 | 2.02 | 0.90 | 2.30 |
| production/A/reopen//favicon.ico | 5 | 0.90 | 1.52 | 0.80 | 1.60 |
| production/A/reopen//api/storage/user/action | 90 | 1.60 | 3.30 | 0.80 | 3.90 |
| production/A/reopen//api/projects | 5 | 1.20 | 2.24 | 0.80 | 2.50 |
| production/A/reopen//api/workspace-files/tree | 5 | 12.50 | 13.72 | 11.80 | 14.00 |
| production/A/reopen//api/storage/project/context | 10 | 1.65 | 2.35 | 1.30 | 2.40 |
| production/A/reopen//api/storage/project/action | 70 | 1.00 | 1.76 | 0.70 | 2.70 |
| production/B/notes-wide//api/storage/user/action | 20 | 0.80 | 1.13 | 0.60 | 1.60 |
| production/B/notes-wide//api/storage/project/action | 2 | 0.75 | 0.80 | 0.70 | 0.80 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 10 | 1.00 | 1.46 | 0.90 | 1.60 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 9 | 1.20 | 2.84 | 0.90 | 3.00 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 2.20 | 2.20 | 2.20 | 2.20 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 0.90 | 0.90 | 0.90 | 0.90 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 26 | 1.00 | 1.80 | 0.70 | 2.10 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 10 | 0.90 | 1.00 | 0.70 | 1.00 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 10 | 0.90 | 1.35 | 0.80 | 1.40 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 10 | 1.05 | 1.31 | 0.90 | 1.40 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 21 | 1.00 | 1.30 | 0.70 | 1.60 |
| production/C/cold-rich-2-group-tree//api/storage/user/action | 1 | 2.50 | 2.50 | 2.50 | 2.50 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 10 | 0.80 | 0.90 | 0.70 | 0.90 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 10 | 0.85 | 1.11 | 0.80 | 1.20 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 10 | 1.15 | 1.20 | 0.90 | 1.20 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 18 | 1.00 | 1.53 | 0.70 | 1.70 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 0.90 | 0.90 | 0.90 | 0.90 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 1.10 | 1.10 | 1.10 | 1.10 |
| production/C/cold-source-1-group-tree//_nuxt/editor.worker-CdQrwHl8.js | 1 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 17 | 1.00 | 1.56 | 0.70 | 1.80 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 15 | 0.90 | 1.18 | 0.60 | 1.60 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 10 | 1.10 | 1.42 | 0.90 | 1.60 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 28 | 0.90 | 1.53 | 0.70 | 1.80 |
| production/C/cold-source-2-group-tree//api/storage/user/action | 4 | 1.65 | 2.07 | 0.70 | 2.10 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 16 | 0.90 | 1.20 | 0.70 | 1.20 |
| production/C/hot-source-2-group-tree//api/storage/user/action | 4 | 2.95 | 3.47 | 1.70 | 3.50 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 12 | 0.90 | 1.08 | 0.70 | 1.30 |
| development/C/cold-rich-1-group-tree//api/storage/user/action | 9 | 1.50 | 2.20 | 0.70 | 2.20 |
| development/C/cold-rich-1-group-tree//api/workspace-files/read | 10 | 1.10 | 1.56 | 0.90 | 1.60 |
| development/C/cold-rich-1-group-tree//api/storage/project/action | 31 | 0.90 | 3.65 | 0.70 | 4.50 |
| development/C/cold-rich-1-group-tree//_nuxt/components/editor-workbench/MarkdownEditorView.vue | 2 | 1.60 | 2.23 | 0.90 | 2.30 |
| development/C/cold-rich-1-group-tree//_nuxt/__uno.css | 1 | 55.00 | 55.00 | 55.00 | 55.00 |
| development/C/cold-rich-1-group-tree//_nuxt/components/markdown-studio/MarkdownCommentFlowPanel.vue | 1 | 5.30 | 5.30 | 5.30 | 5.30 |
| development/C/cold-rich-1-group-tree//_nuxt/composables/useMarkdownEditorController.ts | 1 | 4.50 | 4.50 | 4.50 | 4.50 |
| development/C/hot-rich-1-group-tree//api/storage/project/action | 10 | 0.95 | 1.27 | 0.70 | 1.40 |
| development/C/hot-rich-1-group-tab//api/storage/project/action | 10 | 0.90 | 2.67 | 0.80 | 3.80 |
| development/C/cold-rich-2-group-tree//api/workspace-files/read | 10 | 0.90 | 1.26 | 0.90 | 1.40 |
| development/C/cold-rich-2-group-tree//api/storage/project/action | 20 | 0.90 | 1.00 | 0.70 | 1.00 |
| development/C/cold-rich-2-group-tree//api/storage/user/action | 3 | 1.00 | 1.63 | 0.80 | 1.70 |
| development/C/hot-rich-2-group-tree//api/storage/project/action | 10 | 0.80 | 1.06 | 0.70 | 1.10 |
| development/C/hot-rich-2-group-tab//api/storage/project/action | 10 | 0.80 | 0.90 | 0.70 | 0.90 |
| development/C/cold-source-1-group-tree//api/storage/user/action | 5 | 1.30 | 2.00 | 0.70 | 2.10 |
| development/C/cold-source-1-group-tree//api/workspace-files/read | 10 | 1.00 | 1.26 | 0.90 | 1.40 |
| development/C/cold-source-1-group-tree//api/storage/project/action | 21 | 0.80 | 1.80 | 0.70 | 2.80 |
| development/C/cold-source-1-group-tree//_nuxt/components/editor-workbench/CodeEditorView.vue | 1 | 1.90 | 1.90 | 1.90 | 1.90 |
| development/C/hot-source-1-group-tree//api/storage/project/action | 16 | 0.90 | 1.33 | 0.70 | 1.40 |
| development/C/hot-source-1-group-tab//api/storage/project/action | 14 | 0.90 | 1.37 | 0.80 | 1.50 |
| development/C/cold-source-2-group-tree//api/workspace-files/read | 10 | 0.95 | 1.51 | 0.80 | 1.60 |
| development/C/cold-source-2-group-tree//api/storage/project/action | 23 | 0.90 | 1.48 | 0.70 | 1.80 |
| development/C/cold-source-2-group-tree//api/storage/user/action | 1 | 0.90 | 0.90 | 0.90 | 0.90 |
| development/C/hot-source-2-group-tree//api/storage/project/action | 16 | 0.80 | 0.97 | 0.70 | 1.20 |
| development/C/hot-source-2-group-tree//api/storage/user/action | 1 | 1.30 | 1.30 | 1.30 | 1.30 |
| development/C/hot-source-2-group-tab//api/storage/project/action | 13 | 1.00 | 1.28 | 0.70 | 1.40 |

### Server-Timing

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold/auth.user | 5 | 1.00 | 1.18 | 0.90 | 1.20 |
| production/A/service-cold/config.bootstrap | 15 | 0.90 | 3.00 | 0.50 | 5.10 |
| production/A/service-cold/files.project.ref | 5 | 0.70 | 1.10 | 0.60 | 1.20 |
| production/A/service-cold/files.project.open | 5 | 444.90 | 454.54 | 442.10 | 454.90 |
| production/A/service-cold/projects.manifests | 5 | 0.10 | 0.28 | 0.10 | 0.30 |
| production/A/service-cold/projects.total | 5 | 0.20 | 0.28 | 0.10 | 0.30 |
| production/A/service-cold/files.tree.resolve | 5 | 5.20 | 8.44 | 4.90 | 8.80 |
| production/A/service-cold/files.tree.index | 5 | 3377.80 | 3583.62 | 3204.60 | 3612.90 |
| production/A/reopen/auth.user | 5 | 1.10 | 1.54 | 0.90 | 1.60 |
| production/A/reopen/config.bootstrap | 15 | 0.80 | 1.13 | 0.50 | 1.20 |
| production/A/reopen/files.project.ref | 5 | 0.10 | 0.20 | 0.10 | 0.20 |
| production/A/reopen/files.project.open | 5 | 398.70 | 424.92 | 380.60 | 429.90 |
| production/A/reopen/projects.manifests | 5 | 0.10 | 0.20 | 0.10 | 0.20 |
| production/A/reopen/projects.total | 5 | 0.10 | 0.20 | 0.10 | 0.20 |
| production/A/reopen/files.tree.resolve | 5 | 2.80 | 3.14 | 2.50 | 3.20 |
| production/A/reopen/files.tree.index | 5 | 3065.60 | 3398.16 | 2956.10 | 3479.90 |
| production/C/cold-rich-1-group-tree/files.read.resolve | 10 | 0.40 | 0.50 | 0.30 | 0.50 |
| production/C/cold-rich-1-group-tree/files.read.read | 10 | 2.20 | 2.85 | 1.90 | 2.90 |
| production/C/cold-rich-2-group-tree/files.read.resolve | 10 | 0.40 | 0.55 | 0.30 | 0.60 |
| production/C/cold-rich-2-group-tree/files.read.read | 10 | 2.60 | 3.02 | 2.00 | 3.20 |
| production/C/cold-source-1-group-tree/files.read.resolve | 10 | 0.30 | 0.50 | 0.30 | 0.50 |
| production/C/cold-source-1-group-tree/files.read.read | 10 | 2.00 | 2.41 | 1.80 | 2.50 |
| production/C/cold-source-2-group-tree/files.read.resolve | 10 | 0.30 | 0.55 | 0.30 | 0.60 |
| production/C/cold-source-2-group-tree/files.read.read | 10 | 2.00 | 4.91 | 1.70 | 6.80 |
| development/C/cold-rich-1-group-tree/files.read.resolve | 10 | 0.55 | 0.85 | 0.40 | 0.90 |
| development/C/cold-rich-1-group-tree/files.read.read | 10 | 2.80 | 4.72 | 1.80 | 4.90 |
| development/C/cold-rich-2-group-tree/files.read.resolve | 10 | 0.40 | 2.18 | 0.30 | 3.40 |
| development/C/cold-rich-2-group-tree/files.read.read | 10 | 1.95 | 2.86 | 1.60 | 3.00 |
| development/C/cold-source-1-group-tree/files.read.resolve | 10 | 0.50 | 2.07 | 0.40 | 3.20 |
| development/C/cold-source-1-group-tree/files.read.read | 10 | 1.85 | 2.36 | 1.50 | 2.50 |
| development/C/cold-source-2-group-tree/files.read.resolve | 10 | 0.45 | 1.92 | 0.40 | 3.00 |
| development/C/cold-source-2-group-tree/files.read.read | 10 | 1.90 | 2.35 | 1.60 | 2.40 |

### User Timing

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold/files.tree.client | 5 | 3470.20 | 3689.84 | 3314.50 | 3723.00 |
| production/A/service-cold/files.tree.project | 5 | 77.20 | 77.38 | 74.50 | 77.40 |
| production/A/service-cold/files.tree.build | 5 | 7.50 | 13.36 | 7.20 | 14.20 |
| production/A/reopen/files.tree.client | 5 | 3151.20 | 3492.20 | 3052.90 | 3574.40 |
| production/A/reopen/files.tree.project | 5 | 76.00 | 78.54 | 74.70 | 79.10 |
| production/A/reopen/files.tree.build | 5 | 9.30 | 9.60 | 9.00 | 9.60 |
| production/C/cold-rich-1-group-tree/files.activation | 10 | 956.85 | 1119.41 | 929.50 | 1229.70 |
| production/C/cold-rich-1-group-tree/files.activation.read | 10 | 472.90 | 553.16 | 459.30 | 610.40 |
| production/C/cold-rich-1-group-tree/editor.session.publish | 10 | 0.20 | 0.41 | 0.10 | 0.50 |
| production/C/cold-rich-1-group-tree/editor.tiptap.create | 10 | 487.85 | 585.38 | 58.60 | 645.90 |
| production/C/cold-rich-1-group-tree/editor.tiptap.initialize | 10 | 480.55 | 575.56 | 26.10 | 635.00 |
| production/C/cold-rich-1-group-tree/editor.view.publish | 10 | 0.10 | 0.26 | 0.00 | 0.30 |
| production/C/hot-rich-1-group-tree/editor.session.publish | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-rich-1-group-tree/files.activation | 10 | 473.20 | 479.04 | 455.70 | 479.40 |
| production/C/hot-rich-1-group-tree/editor.view.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-rich-1-group-tab/editor.session.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-rich-1-group-tab/files.activation | 10 | 469.75 | 485.97 | 454.60 | 491.60 |
| production/C/hot-rich-1-group-tab/editor.view.publish | 10 | 0.00 | 0.10 | 0.00 | 0.10 |
| production/C/cold-rich-2-group-tree/files.activation.read | 10 | 465.90 | 505.26 | 455.70 | 522.90 |
| production/C/cold-rich-2-group-tree/files.activation | 10 | 944.95 | 1012.15 | 920.90 | 1048.10 |
| production/C/cold-rich-2-group-tree/editor.session.publish | 10 | 0.10 | 0.30 | 0.10 | 0.30 |
| production/C/cold-rich-2-group-tree/editor.tiptap.create | 10 | 484.70 | 512.39 | 477.00 | 513.20 |
| production/C/cold-rich-2-group-tree/editor.tiptap.initialize | 10 | 475.35 | 501.48 | 467.90 | 502.60 |
| production/C/cold-rich-2-group-tree/editor.view.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-rich-2-group-tree/files.activation | 10 | 478.05 | 486.97 | 455.90 | 487.10 |
| production/C/hot-rich-2-group-tree/editor.session.publish | 10 | 0.30 | 0.36 | 0.10 | 0.40 |
| production/C/hot-rich-2-group-tree/editor.view.publish | 10 | 0.05 | 0.16 | 0.00 | 0.20 |
| production/C/hot-rich-2-group-tab/editor.session.publish | 10 | 0.15 | 0.20 | 0.00 | 0.20 |
| production/C/hot-rich-2-group-tab/files.activation | 10 | 470.70 | 521.88 | 458.10 | 546.40 |
| production/C/hot-rich-2-group-tab/editor.view.publish | 10 | 0.00 | 0.10 | 0.00 | 0.10 |
| production/C/cold-source-1-group-tree/files.activation | 10 | 935.75 | 1085.58 | 914.10 | 1102.00 |
| production/C/cold-source-1-group-tree/files.activation.read | 10 | 470.20 | 533.12 | 450.00 | 533.80 |
| production/C/cold-source-1-group-tree/editor.session.publish | 10 | 0.10 | 0.30 | 0.10 | 0.30 |
| production/C/cold-source-1-group-tree/editor.monaco.mount | 10 | 483.75 | 555.60 | 216.20 | 557.90 |
| production/C/cold-source-1-group-tree/editor.monaco.model | 10 | 0.40 | 3.58 | 0.30 | 5.70 |
| production/C/cold-source-1-group-tree/editor.monaco.create | 10 | 5.15 | 108.13 | 4.70 | 189.40 |
| production/C/cold-source-1-group-tree/editor.view.publish | 10 | 0.00 | 0.27 | 0.00 | 0.40 |
| production/C/hot-source-1-group-tree/editor.session.publish | 10 | 0.10 | 0.16 | 0.00 | 0.20 |
| production/C/hot-source-1-group-tree/files.activation | 10 | 471.55 | 499.18 | 453.10 | 508.40 |
| production/C/hot-source-1-group-tree/editor.view.publish | 10 | 0.00 | 0.10 | 0.00 | 0.10 |
| production/C/hot-source-1-group-tab/editor.session.publish | 10 | 0.05 | 0.16 | 0.00 | 0.20 |
| production/C/hot-source-1-group-tab/files.activation | 10 | 469.75 | 487.86 | 457.20 | 490.60 |
| production/C/hot-source-1-group-tab/editor.view.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/cold-source-2-group-tree/files.activation.read | 10 | 465.20 | 483.39 | 449.90 | 489.60 |
| production/C/cold-source-2-group-tree/files.activation | 10 | 929.10 | 961.19 | 907.10 | 975.50 |
| production/C/cold-source-2-group-tree/editor.session.publish | 10 | 0.15 | 0.20 | 0.00 | 0.20 |
| production/C/cold-source-2-group-tree/editor.monaco.mount | 10 | 460.55 | 497.91 | 453.30 | 512.90 |
| production/C/cold-source-2-group-tree/editor.monaco.model | 10 | 0.30 | 0.46 | 0.20 | 0.50 |
| production/C/cold-source-2-group-tree/editor.monaco.create | 10 | 6.95 | 13.02 | 4.70 | 17.30 |
| production/C/cold-source-2-group-tree/editor.view.publish | 10 | 0.00 | 0.10 | 0.00 | 0.10 |
| production/C/hot-source-2-group-tree/files.activation | 10 | 466.15 | 475.04 | 450.00 | 476.30 |
| production/C/hot-source-2-group-tree/editor.session.publish | 10 | 0.20 | 0.30 | 0.10 | 0.30 |
| production/C/hot-source-2-group-tree/editor.view.publish | 10 | 0.05 | 0.10 | 0.00 | 0.10 |
| production/C/hot-source-2-group-tab/editor.session.publish | 10 | 0.10 | 0.21 | 0.00 | 0.30 |
| production/C/hot-source-2-group-tab/files.activation | 10 | 472.00 | 484.63 | 452.10 | 484.90 |
| production/C/hot-source-2-group-tab/editor.view.publish | 10 | 0.05 | 0.10 | 0.00 | 0.10 |
| development/C/cold-rich-1-group-tree/files.activation | 10 | 1056.00 | 1068.20 | 982.70 | 1071.40 |
| development/C/cold-rich-1-group-tree/files.activation.read | 10 | 482.15 | 505.74 | 464.40 | 511.90 |
| development/C/cold-rich-1-group-tree/editor.session.publish | 10 | 0.15 | 0.30 | 0.10 | 0.30 |
| development/C/cold-rich-1-group-tree/editor.tiptap.create | 10 | 554.90 | 578.95 | 93.60 | 591.10 |
| development/C/cold-rich-1-group-tree/editor.tiptap.initialize | 10 | 545.50 | 569.58 | 31.80 | 582.00 |
| development/C/cold-rich-1-group-tree/editor.view.publish | 10 | 0.10 | 0.31 | 0.10 | 0.40 |
| development/C/hot-rich-1-group-tree/editor.session.publish | 10 | 0.15 | 0.20 | 0.10 | 0.20 |
| development/C/hot-rich-1-group-tree/files.activation | 10 | 476.60 | 528.90 | 467.80 | 540.20 |
| development/C/hot-rich-1-group-tree/editor.view.publish | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| development/C/hot-rich-1-group-tab/editor.session.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| development/C/hot-rich-1-group-tab/files.activation | 10 | 463.25 | 605.57 | 455.80 | 667.40 |
| development/C/hot-rich-1-group-tab/editor.view.publish | 10 | 0.10 | 0.16 | 0.00 | 0.20 |
| development/C/cold-rich-2-group-tree/files.activation.read | 10 | 462.75 | 469.50 | 452.60 | 470.90 |
| development/C/cold-rich-2-group-tree/files.activation | 10 | 930.10 | 961.29 | 917.20 | 964.40 |
| development/C/cold-rich-2-group-tree/editor.session.publish | 10 | 0.20 | 0.26 | 0.10 | 0.30 |
| development/C/cold-rich-2-group-tree/editor.tiptap.create | 10 | 474.05 | 484.73 | 469.30 | 486.80 |
| development/C/cold-rich-2-group-tree/editor.tiptap.initialize | 10 | 462.70 | 467.91 | 457.50 | 468.90 |
| development/C/cold-rich-2-group-tree/editor.view.publish | 10 | 0.10 | 0.20 | 0.10 | 0.20 |
| development/C/hot-rich-2-group-tree/editor.session.publish | 10 | 0.20 | 0.30 | 0.00 | 0.30 |
| development/C/hot-rich-2-group-tree/files.activation | 10 | 478.10 | 500.36 | 461.70 | 506.30 |
| development/C/hot-rich-2-group-tree/editor.view.publish | 10 | 0.00 | 0.10 | 0.00 | 0.10 |
| development/C/hot-rich-2-group-tab/editor.session.publish | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| development/C/hot-rich-2-group-tab/files.activation | 10 | 467.50 | 499.28 | 457.80 | 503.60 |
| development/C/hot-rich-2-group-tab/editor.view.publish | 10 | 0.05 | 0.10 | 0.00 | 0.10 |
| development/C/cold-source-1-group-tree/files.activation.read | 10 | 470.70 | 507.37 | 461.70 | 517.00 |
| development/C/cold-source-1-group-tree/files.activation | 10 | 947.80 | 988.62 | 926.80 | 997.80 |
| development/C/cold-source-1-group-tree/editor.session.publish | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| development/C/cold-source-1-group-tree/editor.monaco.mount | 10 | 466.35 | 487.41 | 393.10 | 493.30 |
| development/C/cold-source-1-group-tree/editor.monaco.model | 10 | 0.50 | 4.77 | 0.40 | 8.10 |
| development/C/cold-source-1-group-tree/editor.monaco.create | 10 | 6.75 | 205.26 | 5.50 | 367.40 |
| development/C/cold-source-1-group-tree/editor.view.publish | 10 | 0.10 | 0.16 | 0.00 | 0.20 |
| development/C/hot-source-1-group-tree/editor.session.publish | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| development/C/hot-source-1-group-tree/files.activation | 10 | 502.80 | 563.78 | 469.80 | 577.10 |
| development/C/hot-source-1-group-tree/editor.view.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| development/C/hot-source-1-group-tab/editor.session.publish | 10 | 0.00 | 0.10 | 0.00 | 0.10 |
| development/C/hot-source-1-group-tab/files.activation | 10 | 472.55 | 481.83 | 463.00 | 484.80 |
| development/C/hot-source-1-group-tab/editor.view.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| development/C/cold-source-2-group-tree/files.activation.read | 10 | 468.75 | 493.17 | 457.60 | 500.10 |
| development/C/cold-source-2-group-tree/files.activation | 10 | 935.75 | 976.80 | 923.70 | 981.30 |
| development/C/cold-source-2-group-tree/editor.session.publish | 10 | 0.15 | 0.26 | 0.10 | 0.30 |
| development/C/cold-source-2-group-tree/editor.monaco.mount | 10 | 477.20 | 517.47 | 458.70 | 532.50 |
| development/C/cold-source-2-group-tree/editor.monaco.model | 10 | 0.20 | 0.40 | 0.10 | 0.40 |
| development/C/cold-source-2-group-tree/editor.monaco.create | 10 | 6.05 | 10.71 | 5.40 | 14.00 |
| development/C/cold-source-2-group-tree/editor.view.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| development/C/hot-source-2-group-tree/editor.session.publish | 10 | 0.20 | 0.30 | 0.00 | 0.30 |
| development/C/hot-source-2-group-tree/files.activation | 10 | 475.90 | 500.59 | 465.10 | 506.30 |
| development/C/hot-source-2-group-tree/editor.view.publish | 10 | 0.00 | 0.16 | 0.00 | 0.20 |
| development/C/hot-source-2-group-tab/editor.session.publish | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| development/C/hot-source-2-group-tab/files.activation | 10 | 481.40 | 491.64 | 464.40 | 498.70 |
| development/C/hot-source-2-group-tab/editor.view.publish | 10 | 0.10 | 0.20 | 0.00 | 0.20 |

### 各操作最长主线程任务

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold | 5 | 2068.00 | 2130.20 | 2013.00 | 2143.00 |
| production/A/reopen | 5 | 2045.00 | 2200.00 | 2033.00 | 2230.00 |
| production/B/notes-wide | 10 | 94.00 | 113.55 | 91.00 | 114.00 |
| production/C/cold-rich-1-group-tree | 10 | 944.50 | 1114.60 | 909.00 | 1228.00 |
| production/C/hot-rich-1-group-tree | 10 | 931.00 | 965.75 | 900.00 | 986.00 |
| production/C/hot-rich-1-group-tab | 10 | 934.00 | 960.30 | 908.00 | 972.00 |
| production/C/cold-rich-2-group-tree | 10 | 941.00 | 997.90 | 919.00 | 1015.00 |
| production/C/hot-rich-2-group-tree | 10 | 937.00 | 955.90 | 906.00 | 964.00 |
| production/C/hot-rich-2-group-tab | 10 | 937.50 | 1027.50 | 918.00 | 1086.00 |
| production/C/cold-source-1-group-tree | 10 | 962.50 | 1110.45 | 913.00 | 1128.00 |
| production/C/hot-source-1-group-tree | 10 | 935.00 | 980.05 | 890.00 | 985.00 |
| production/C/hot-source-1-group-tab | 10 | 939.00 | 954.55 | 908.00 | 955.00 |
| production/C/cold-source-2-group-tree | 10 | 924.00 | 978.15 | 911.00 | 1011.00 |
| production/C/hot-source-2-group-tree | 10 | 911.00 | 933.30 | 891.00 | 936.00 |
| production/C/hot-source-2-group-tab | 10 | 927.50 | 950.05 | 905.00 | 964.00 |
| development/C/cold-rich-1-group-tree | 10 | 1033.50 | 1101.75 | 1004.00 | 1131.00 |
| development/C/hot-rich-1-group-tree | 10 | 943.00 | 1035.00 | 922.00 | 1053.00 |
| development/C/hot-rich-1-group-tab | 10 | 931.50 | 1278.00 | 909.00 | 1512.00 |
| development/C/cold-rich-2-group-tree | 10 | 915.50 | 945.55 | 904.00 | 946.00 |
| development/C/hot-rich-2-group-tree | 10 | 937.00 | 974.90 | 908.00 | 983.00 |
| development/C/hot-rich-2-group-tab | 10 | 929.00 | 963.55 | 907.00 | 964.00 |
| development/C/cold-source-1-group-tree | 10 | 940.50 | 967.00 | 928.00 | 976.00 |
| development/C/hot-source-1-group-tree | 10 | 960.00 | 1127.50 | 915.00 | 1159.00 |
| development/C/hot-source-1-group-tab | 10 | 936.50 | 955.85 | 919.00 | 959.00 |
| development/C/cold-source-2-group-tree | 10 | 952.00 | 987.25 | 923.00 | 1003.00 |
| development/C/hot-source-2-group-tree | 10 | 929.00 | 963.55 | 913.00 | 964.00 |
| development/C/hot-source-2-group-tab | 10 | 942.00 | 971.75 | 931.00 | 974.00 |

## 性能标准对照

采用 p95 与规范时限作对照；规范本身没有指定分位数，因此本表是报告约定，不是改写产品合同。

| 变体 | 规范时限 ms | 实测 p95 ms | 结果 |
|---|---:|---:|---|
| production/A/service-cold | 1000 | 6349.82 | p95 超出 |
| production/A/reopen | 300 | 6171.96 | p95 超出 |
| production/C/cold-rich-1-group-tree | 200 | 1929.06 | p95 超出 |
| production/C/hot-rich-1-group-tree | 100 | 1165.75 | p95 超出 |
| production/C/hot-rich-1-group-tab | 100 | 971.40 | p95 超出 |
| production/C/cold-rich-2-group-tree | 200 | 1710.96 | p95 超出 |
| production/C/hot-rich-2-group-tree | 100 | 1147.54 | p95 超出 |
| production/C/hot-rich-2-group-tab | 100 | 1032.28 | p95 超出 |
| production/C/cold-source-1-group-tree | 200 | 1913.36 | p95 超出 |
| production/C/hot-source-1-group-tree | 100 | 1198.05 | p95 超出 |
| production/C/hot-source-1-group-tab | 100 | 983.24 | p95 超出 |
| production/C/cold-source-2-group-tree | 200 | 1671.59 | p95 超出 |
| production/C/hot-source-2-group-tree | 100 | 1144.16 | p95 超出 |
| production/C/hot-source-2-group-tab | 100 | 978.25 | p95 超出 |

## 测量设计与环境

- 固定种子 42017，生成 3000 个 Markdown，5120–30720 bytes，合成文件共 52769090 bytes；root: 1 (0.03%)；lorebook: 899 (29.97%)；manuscript: 999 (33.30%)；notes: 1101 (36.70%)。产品创建时的默认模板文件保留，fileCount/totalBytes 只统计生成器。普通主体目录深度 3–5 层；index.md 与宽目录是明确的浅层入口。
- 用真实 POST /api/projects 创建项目后写入返回 projectRoot 对应的隔离 State Root；项目卡片的真实 click 发起打开。rich 与 source 使用不同项目，避免旧标签与分组恢复污染。
- 起止判定：{"percentile":"线性插值，位置 (n-1)*p；仅成功且输入验证通过的样本进入统计","tree":"click 捕获事件至三个根目录已渲染、可命中，连续两个动画帧成立","directory":"直接子行全部渲染、展开动画结束，连续两个动画帧成立","editor":"当前活动组目标标签选中、正确标记出现在可见编辑器、输入可写且不 busy；连续两个动画帧成立；窗口外输入并撤销","cold":"A 每次重启服务；C 每次用该项目中从未打开的文件；不清 OS 页缓存","desktop":"桌面版未测"}。
- 样本统计保留 Resource Timing、Server-Timing、固定名字的 User Timing measure、Long Tasks、Long Animation Frames 原始条目；每个样本记录 loadAverage。常驻计时不生成 mark 或序号名字。
- 环境：{"hostname":"archlinux","platform":"linux","arch":"x64","bun":"1.4.2","cpuModel":"Intel(R) Core(TM) i5-1035G1 CPU @ 1.00GHz","cpuCount":8,"memoryBytes":16429027328,"chrome":"151.0.7922.71","loadAtStart":[2.11,2.71,1.68],"loadAtEnd":[2.2,2.13,2.06],"viewport":{"width":1440,"height":1000},"headless":true}。
- State Root：/tmp/neuro-book/t42-files-baseline-vOuekw/state；样本、State Root 与独立 Chrome profile 已清理=true；仅超限 profiling 文件留存=[]。
- 构建日志：/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-build.log；命令与逐次服务启动日志与报告同目录。

## 跟踪与 CPU 采样

| 运行 | 采样对象 | CPU 样本数 | 分类采样区间 ms | 原始文件 |
|---|---|---:|---|---|
| accept-3000-directory-expand | browser | 400 | {"未归类 CPU":214.60200000000026,"空闲或原生未归类":141.09799999999998} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-directory-expand.cpuprofile (30006 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-directory-expand.trace.json (690802 bytes) |
| accept-3000-production-rich-1-group | browser | 1619 | {"未归类 CPU":236.497,"空闲或原生未归类":121.632,"Vue 深度遍历":1264.4510000000002,"垃圾回收":16.479999999999997,"富文本控件与视图":7.545,"Vue 更新":1.095} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-production-rich-1-group.cpuprofile (156162 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-production-rich-1-group.trace.json (391984 bytes) |
| accept-3000-production-rich-2-group | browser | 1920 | {"未归类 CPU":279.617,"空闲或原生未归类":119.32099999999986,"Vue 深度遍历":1524.1030000000017,"垃圾回收":17.627,"富文本控件与视图":11.775,"Monaco 模型与控件":1.057} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-production-rich-2-group.cpuprofile (198695 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-production-rich-2-group.trace.json (523627 bytes) |
| accept-3000-production-source-1-group | browser | 1639 | {"未归类 CPU":256.1209999999999,"空闲或原生未归类":125.04399999999997,"Vue 深度遍历":1228.1399999999946,"垃圾回收":12.943000000000001,"Monaco 模型与控件":10.611999999999998,"Vue 更新":10.44} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-production-source-1-group.cpuprofile (177662 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-production-source-1-group.trace.json (438786 bytes) |
| accept-3000-production-source-2-group | browser | 1718 | {"未归类 CPU":291.4849999999999,"Vue 更新":12.23,"空闲或原生未归类":112.43699999999994,"Vue 深度遍历":1292.569,"垃圾回收":20.275000000000002,"Monaco 模型与控件":9.604} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-production-source-2-group.cpuprofile (202372 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-production-source-2-group.trace.json (426388 bytes) |
| accept-3000-development-rich-1-group | browser | 1604 | {"未归类 CPU":116.92900006103517,"Vue 更新":126.47399999999992,"空闲或原生未归类":106.95299999999999,"富文本控件与视图":17.633,"Vue 深度遍历":1254.859,"垃圾回收":15.352000000000002} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-development-rich-1-group.cpuprofile (314738 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-development-rich-1-group.trace.json (388380 bytes) |
| accept-3000-development-rich-2-group | browser | 1657 | {"Vue 更新":132.7769999999999,"未归类 CPU":101.63900000000002,"空闲或原生未归类":122.45300000000006,"Vue 深度遍历":1280.2950000000008,"垃圾回收":14.166,"富文本控件与视图":20.470000000000002} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-development-rich-2-group.cpuprofile (334559 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-development-rich-2-group.trace.json (426438 bytes) |
| accept-3000-development-source-1-group | browser | 1666 | {"未归类 CPU":122.15599999999995,"Monaco 模型与控件":40.86999999999999,"空闲或原生未归类":117.28099999999995,"Vue 更新":124.84099999999995,"Vue 深度遍历":1272.2309999999957,"垃圾回收":15.210000000000003,"富文本控件与视图":8.911} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-development-source-1-group.cpuprofile (361317 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-development-source-1-group.trace.json (472522 bytes) |
| accept-3000-development-source-2-group | browser | 1667 | {"未归类 CPU":134.608,"Vue 更新":129.17299999999997,"空闲或原生未归类":103.194,"Vue 深度遍历":1262.8650000000007,"垃圾回收":17.508,"Monaco 模型与控件":48.296,"富文本控件与视图":8.156} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-development-source-2-group.cpuprofile (359238 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-development-source-2-group.trace.json (433536 bytes) |
| accept-3000-project-open | browser | 7013 | {"未归类 CPU":918.6579999389638,"空闲或原生未归类":3677.4589999999894,"Vue 深度遍历":1762.2820000000013,"垃圾回收":122.001} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-project-open.cpuprofile (550539 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-project-open.trace.json (2580478 bytes) |
| accept-3000-server-project-open | server | 2557 | {"未归类 CPU":4141.25025,"frontmatter 与 YAML":1665.071999999999,"目录与索引（含路径校验）":630.1870000000004,"垃圾回收":0.979,"文件读取 CPU":2.0789999999999997,"索引问题校验":40.832999999999984} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-3000-server-project-open.cpuprofile (964598 bytes) |

### 服务代表窗口构成

| 代表运行与类别 | 分类采样区间 ms | 占打开窗口 |
|---|---:|---:|
| accept-3000-server-project-open/未归类 CPU | 4141.25 | 63.90% |
| accept-3000-server-project-open/frontmatter 与 YAML | 1665.07 | 25.69% |
| accept-3000-server-project-open/目录与索引（含路径校验） | 630.19 | 9.72% |
| accept-3000-server-project-open/垃圾回收 | 0.98 | 0.02% |
| accept-3000-server-project-open/文件读取 CPU | 2.08 | 0.03% |
| accept-3000-server-project-open/索引问题校验 | 40.83 | 0.63% |

这些类别分配相邻采样时间戳区间，不是精确 CPU 活跃时间；原生、异步 I/O 与稀疏采样间隔仍可能归到当前栈，未归类不自动解释为 CPU 或磁盘。服务 timeDeltas 原值与 topFunctions 保留在 JSON/profile，复核时不能仅凭压缩名认定热点。

### 切换代表窗口的 Vue 深度遍历

| 代表运行 | 操作窗口 ms | traverse 分类采样区间 ms | 占窗口 |
|---|---:|---:|---:|
| accept-3000-production-rich-1-group | 1647.70 | 1264.45 | 76.74% |
| accept-3000-production-rich-2-group | 1953.50 | 1524.10 | 78.02% |
| accept-3000-production-source-1-group | 1643.30 | 1228.14 | 74.74% |
| accept-3000-production-source-2-group | 1738.60 | 1292.57 | 74.35% |
| accept-3000-development-rich-1-group | 1638.20 | 1254.86 | 76.60% |
| accept-3000-development-rich-2-group | 1671.80 | 1280.30 | 76.58% |
| accept-3000-development-source-1-group | 1701.50 | 1272.23 | 74.77% |
| accept-3000-development-source-2-group | 1703.80 | 1262.87 | 74.12% |

同名函数必须匹配脚本 URL 与函数行列范围后才计入 traverse。该证据定位到 Vue 深度 watch/effect 的同步工作；Pinia/persist 的具体订阅因果尚无禁用订阅等干预实验。控件创建与网络小并不等同于全部剩余延迟都来自同一订阅。

服务 CPU profile 使用 Bun --cpu-prof，采样真正 .output/server/index.mjs 进程；按 performance.timeOrigin 与 startTime 对齐，只统计代表性打开窗口。parseMarkdownDocument、scanWorkspaceTree、visitPath、buildWorkspaceNode、createProjectIssues、readWorkspaceTextFile 在本次构建 AST 中以独特函数体识别，记录压缩名、行列与 matchedBy；仅唯一匹配映射参与祖先栈归类。frontmatter 优先于其外层索引栈，未归类部分保留；CPU 采样不等于异步 I/O wall-clock。
Chrome 使用 1000 µs CPU sampling 和 devtools.timeline/blink.user_timing/v8.execute trace。独立采样脚本的 files.baseline.profile-clock mark 对齐 monotonic 微秒时钟；只统计 sample click-to-ready 窗口，trace 只取同 pid/tid 页面主线程。Vue traverse 以 __v_skip/new Map/Object.getOwnPropertySymbols/propertyIsEnumerable 独特函数体唯一识别，匹配真实脚本 URL 与函数行列范围后归为 Vue 深度遍历；其余按 parseMarkdown/createDoc/createSchema/DOMParser 归类解析与模型、EditorView/createView/updateState 归类富文本控件、Monaco model/widget/tokenizer、建树和 Vue 祖先栈归类。未识别部分保留未归类。Layout/UpdateLayoutTree/Paint 与 RunTask/FunctionCall 嵌套，不能相加。独立时钟 mark 会立即清理，不进入常规样本。

CPU 时间重建：累加 timeDeltas 得到时间戳后排序，再按非重叠相邻区间归类；负 delta 数量保留于 cpu.negativeDeltaCount，原始 profile 不改写。协议参考：[CDP Profiler Profile](https://chromedevtools.github.io/devtools-protocol/tot/Profiler/#type-Profile)。Monaco 原生输入宿主的判据来自已安装版本 nativeEditContext.js，并由键盘 smoke 实证。

## 常驻计时点

| 文件 | 名字 | 所有者边界 |
|---|---|---|
| server/api/projects/open.post.ts | files.project.ref | 读取并校验打开请求 |
| server/api/projects/open.post.ts | files.project.open | Project Session 与 required 模块 minimum-ready；完整 File Index warm-up 在后台 |
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

diagnostics 只记录脚本异常与收口失败；浏览器 pageerror、console.error、开发优化重载及健康检查重试保留在运行日志。完整运行通过表示测量矩阵、代表 profiling 和清理完成，不表示准备阶段没有产品异常。
