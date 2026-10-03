# Files 现状耗时基线

生成时间：2026-10-03T07:18:56.922Z；HEAD：a7346d225d48b8496078001a5ddfa656da85e827；生产镜像身份详见 JSON build.image。

完整运行：通过；有效样本 770/770。桌面版未测。

## A. 打开项目

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold | 10 | 6226.30 | 7421.13 | 5928.90 | 7433.10 |
| production/A/reopen | 10 | 5814.40 | 6441.68 | 5217.90 | 6571.10 |

服务冷开每次重启自有 Product；reopen 在同进程内关闭并再次打开。两者都会经历真实 Project Session 生命周期，OS 页缓存保持自然状态。

### 打开项目的互斥区间

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| service-cold/点击至 open 响应结束 | 10 | 519.80 | 609.00 | 504.30 | 612.60 |
| service-cold/open 响应结束至 tree 响应结束 | 10 | 3643.90 | 4724.03 | 3458.80 | 4790.00 |
| service-cold/tree 响应结束至可操作 | 10 | 2008.00 | 2204.77 | 1950.20 | 2227.40 |
| reopen/点击至 open 响应结束 | 10 | 456.15 | 541.18 | 427.60 | 562.60 |
| reopen/open 响应结束至 tree 响应结束 | 10 | 3310.35 | 3814.32 | 2876.30 | 3984.20 |
| reopen/tree 响应结束至可操作 | 10 | 2014.00 | 2215.59 | 1910.50 | 2217.30 |

三个区间在同一样本内相加等于打开总耗时；各列分位数不能相加。open 接口只等 required 模块 minimum-ready，File Index 在后台共享 warm-up，tree 请求等待完整快照。接口 wall-clock、frontmatter CPU 采样与前端 User Timing 分开解释。

### 前端投影与建树

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold/files.tree.project | 10 | 73.15 | 79.02 | 69.60 | 79.60 |
| production/A/service-cold/files.tree.build | 10 | 9.30 | 10.45 | 8.40 | 10.50 |
| production/A/reopen/files.tree.project | 10 | 80.35 | 88.49 | 74.70 | 90.20 |
| production/A/reopen/files.tree.build | 10 | 9.15 | 12.95 | 8.30 | 13.90 |

tree 响应结束至可操作还包含 JSON 解码、响应状态提交、Vue 更新、DOM 渲染和两帧确认；不能把整个残余区间标为建树或纯渲染。代表 Chrome profile 与 Layout/UpdateLayoutTree/Paint 原始跟踪见下文。

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
| development/C/cold-rich-1-group-tree | 30 | 1631.10 | 1855.60 | 1523.00 | 2743.30 |
| development/C/hot-rich-1-group-tree | 30 | 1080.80 | 1120.10 | 1063.60 | 1124.80 |
| development/C/hot-rich-1-group-tab | 30 | 890.70 | 920.42 | 875.60 | 985.10 |
| development/C/cold-rich-2-group-tree | 30 | 1560.20 | 1634.15 | 1520.30 | 1676.40 |
| development/C/hot-rich-2-group-tree | 30 | 1074.70 | 1093.64 | 1058.10 | 1127.70 |
| development/C/hot-rich-2-group-tab | 30 | 894.85 | 944.47 | 879.80 | 955.30 |
| development/C/cold-source-1-group-tree | 30 | 1663.60 | 1712.21 | 1626.40 | 2168.60 |
| development/C/hot-source-1-group-tree | 30 | 1160.10 | 1201.53 | 1136.20 | 1373.90 |
| development/C/hot-source-1-group-tab | 30 | 973.00 | 999.27 | 950.60 | 1004.20 |
| development/C/cold-source-2-group-tree | 30 | 1652.95 | 1691.28 | 1620.20 | 1742.10 |
| development/C/hot-source-2-group-tree | 30 | 1163.10 | 1203.92 | 1135.10 | 1250.30 |
| development/C/hot-source-2-group-tab | 30 | 981.50 | 1025.79 | 957.80 | 1029.70 |

cold 是项目内首次打开的不同文件。hot-tree 从文件树单击两个已保留标签的文件；hot-tab 从标签按钮切换。富文本／源码、单组／双组独立记录，预热与 profiling 不进入常规统计。

热切换 480 次期间 stat/read 请求合计 0；是否重建控件由固定 User Timing measure 与独立 CPU profile 交叉核对。没有 read 请求的热标签延迟不能归因服务端读文件。

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
| development/C/cold-rich-1-group-tree/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-rich-1-group-tree/read | 30 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/hot-rich-1-group-tree/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-1-group-tree/read | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-1-group-tab/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-1-group-tab/read | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-rich-2-group-tree/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-rich-2-group-tree/read | 30 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/hot-rich-2-group-tree/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-2-group-tree/read | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-2-group-tab/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-2-group-tab/read | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-source-1-group-tree/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-source-1-group-tree/read | 30 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/hot-source-1-group-tree/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-1-group-tree/read | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-1-group-tab/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-1-group-tab/read | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-source-2-group-tree/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/cold-source-2-group-tree/read | 30 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/hot-source-2-group-tree/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-2-group-tree/read | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-2-group-tab/stat | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-2-group-tab/read | 30 | 0.00 | 0.00 | 0.00 | 0.00 |

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
| development/C/cold-rich-1-group-tree/selectionMs | 30 | 3.55 | 5.32 | 3.10 | 5.60 |
| development/C/cold-rich-1-group-tree/tabMs | 30 | 1583.90 | 1671.19 | 1490.30 | 1891.20 |
| development/C/hot-rich-1-group-tree/selectionMs | 30 | 3.30 | 3.95 | 3.10 | 4.20 |
| development/C/hot-rich-1-group-tree/tabMs | 30 | 1064.75 | 1103.98 | 1048.90 | 1110.30 |
| development/C/hot-rich-1-group-tab/selectionMs | 30 | 874.25 | 902.82 | 860.20 | 970.10 |
| development/C/hot-rich-1-group-tab/tabMs | 30 | 874.25 | 902.82 | 860.20 | 970.10 |
| development/C/cold-rich-2-group-tree/selectionMs | 30 | 3.50 | 4.63 | 3.20 | 5.40 |
| development/C/cold-rich-2-group-tree/tabMs | 30 | 1526.75 | 1598.79 | 1490.90 | 1646.20 |
| development/C/hot-rich-2-group-tree/selectionMs | 30 | 3.40 | 3.70 | 2.90 | 6.50 |
| development/C/hot-rich-2-group-tree/tabMs | 30 | 1065.15 | 1082.92 | 1046.70 | 1113.40 |
| development/C/hot-rich-2-group-tab/selectionMs | 30 | 885.00 | 933.84 | 870.90 | 945.90 |
| development/C/hot-rich-2-group-tab/tabMs | 30 | 885.00 | 933.84 | 870.90 | 945.90 |
| development/C/cold-source-1-group-tree/selectionMs | 30 | 4.30 | 5.21 | 3.40 | 5.60 |
| development/C/cold-source-1-group-tree/tabMs | 30 | 1628.00 | 1666.01 | 1590.80 | 1675.20 |
| development/C/hot-source-1-group-tree/selectionMs | 30 | 4.20 | 5.40 | 3.90 | 6.70 |
| development/C/hot-source-1-group-tree/tabMs | 30 | 1126.35 | 1168.91 | 1108.40 | 1339.60 |
| development/C/hot-source-1-group-tab/selectionMs | 30 | 941.95 | 963.96 | 926.00 | 981.20 |
| development/C/hot-source-1-group-tab/tabMs | 30 | 941.95 | 963.96 | 926.00 | 981.20 |
| development/C/cold-source-2-group-tree/selectionMs | 30 | 4.10 | 4.50 | 3.80 | 4.90 |
| development/C/cold-source-2-group-tree/tabMs | 30 | 1615.55 | 1660.27 | 1586.40 | 1705.10 |
| development/C/hot-source-2-group-tree/selectionMs | 30 | 4.20 | 5.21 | 3.60 | 6.40 |
| development/C/hot-source-2-group-tree/tabMs | 30 | 1130.80 | 1167.56 | 1102.10 | 1220.70 |
| development/C/hot-source-2-group-tab/selectionMs | 30 | 950.25 | 991.72 | 930.90 | 1000.90 |
| development/C/hot-source-2-group-tab/tabMs | 30 | 950.25 | 991.72 | 930.90 | 1000.90 |

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
| development/C/cold-rich-1-group-tree/clickToActivation | 30 | 180.40 | 181.89 | 180.30 | 183.60 |
| development/C/cold-rich-1-group-tree/activationToReadEnd | 30 | 15.20 | 20.94 | 11.90 | 23.60 |
| development/C/cold-rich-1-group-tree/readEndToSession | 30 | 429.30 | 477.79 | 415.50 | 522.40 |
| development/C/cold-rich-1-group-tree/sessionToView | 30 | 964.05 | 1124.54 | 883.60 | 2060.30 |
| development/C/cold-rich-1-group-tree/viewToEditable | 30 | 39.70 | 52.30 | 26.90 | 67.20 |
| development/C/hot-rich-1-group-tree/clickToActivation | 30 | 180.40 | 181.92 | 180.20 | 182.20 |
| development/C/hot-rich-1-group-tree/activationToReadEnd | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-1-group-tree/readEndToSession | 30 | 0.10 | 0.20 | 0.00 | 0.20 |
| development/C/hot-rich-1-group-tree/sessionToView | 30 | 429.60 | 448.52 | 418.00 | 450.70 |
| development/C/hot-rich-1-group-tree/viewToEditable | 30 | 470.30 | 494.78 | 458.20 | 502.50 |
| development/C/hot-rich-1-group-tab/clickToActivation | 30 | 0.10 | 0.20 | 0.00 | 0.30 |
| development/C/hot-rich-1-group-tab/activationToReadEnd | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-1-group-tab/readEndToSession | 30 | 0.10 | 0.20 | 0.00 | 0.20 |
| development/C/hot-rich-1-group-tab/sessionToView | 30 | 425.35 | 450.13 | 419.10 | 472.20 |
| development/C/hot-rich-1-group-tab/viewToEditable | 30 | 464.05 | 482.13 | 453.90 | 512.70 |
| development/C/cold-rich-2-group-tree/clickToActivation | 30 | 180.40 | 181.44 | 180.30 | 182.20 |
| development/C/cold-rich-2-group-tree/activationToReadEnd | 30 | 14.50 | 17.83 | 10.20 | 20.20 |
| development/C/cold-rich-2-group-tree/readEndToSession | 30 | 431.45 | 443.40 | 417.50 | 478.60 |
| development/C/cold-rich-2-group-tree/sessionToView | 30 | 907.40 | 974.95 | 883.60 | 979.20 |
| development/C/cold-rich-2-group-tree/viewToEditable | 30 | 26.90 | 30.11 | 22.70 | 30.40 |
| development/C/hot-rich-2-group-tree/clickToActivation | 30 | 180.50 | 181.47 | 180.30 | 184.60 |
| development/C/hot-rich-2-group-tree/activationToReadEnd | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-2-group-tree/readEndToSession | 30 | 0.30 | 0.40 | 0.20 | 0.40 |
| development/C/hot-rich-2-group-tree/sessionToView | 30 | 429.60 | 441.19 | 419.90 | 482.70 |
| development/C/hot-rich-2-group-tree/viewToEditable | 30 | 463.40 | 477.52 | 453.00 | 489.80 |
| development/C/hot-rich-2-group-tab/clickToActivation | 30 | 0.20 | 0.26 | 0.00 | 0.30 |
| development/C/hot-rich-2-group-tab/activationToReadEnd | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-rich-2-group-tab/readEndToSession | 30 | 0.10 | 0.25 | 0.00 | 0.30 |
| development/C/hot-rich-2-group-tab/sessionToView | 30 | 432.90 | 459.79 | 422.00 | 470.70 |
| development/C/hot-rich-2-group-tab/viewToEditable | 30 | 462.65 | 490.50 | 453.70 | 496.00 |
| development/C/cold-source-1-group-tree/clickToActivation | 30 | 180.40 | 183.56 | 180.20 | 186.70 |
| development/C/cold-source-1-group-tree/activationToReadEnd | 30 | 12.85 | 17.65 | 9.70 | 21.80 |
| development/C/cold-source-1-group-tree/readEndToSession | 30 | 466.25 | 476.41 | 454.70 | 480.10 |
| development/C/cold-source-1-group-tree/sessionToView | 30 | 957.75 | 992.36 | 930.10 | 1410.10 |
| development/C/cold-source-1-group-tree/viewToEditable | 30 | 48.05 | 60.56 | 38.60 | 96.90 |
| development/C/hot-source-1-group-tree/clickToActivation | 30 | 180.75 | 184.21 | 180.20 | 186.40 |
| development/C/hot-source-1-group-tree/activationToReadEnd | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-1-group-tree/readEndToSession | 30 | 0.10 | 0.20 | 0.00 | 0.20 |
| development/C/hot-source-1-group-tree/sessionToView | 30 | 457.40 | 482.43 | 444.30 | 568.80 |
| development/C/hot-source-1-group-tree/viewToEditable | 30 | 519.60 | 547.37 | 504.10 | 624.60 |
| development/C/hot-source-1-group-tab/clickToActivation | 30 | 0.10 | 0.20 | 0.00 | 0.20 |
| development/C/hot-source-1-group-tab/activationToReadEnd | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-1-group-tab/readEndToSession | 30 | 0.10 | 0.10 | 0.00 | 0.20 |
| development/C/hot-source-1-group-tab/sessionToView | 30 | 459.05 | 473.52 | 448.10 | 478.30 |
| development/C/hot-source-1-group-tab/viewToEditable | 30 | 512.25 | 532.76 | 498.70 | 540.70 |
| development/C/cold-source-2-group-tree/clickToActivation | 30 | 180.45 | 185.79 | 180.30 | 189.80 |
| development/C/cold-source-2-group-tree/activationToReadEnd | 30 | 11.35 | 15.31 | 9.80 | 22.60 |
| development/C/cold-source-2-group-tree/readEndToSession | 30 | 464.90 | 481.44 | 446.50 | 517.50 |
| development/C/cold-source-2-group-tree/sessionToView | 30 | 946.25 | 977.99 | 929.50 | 984.50 |
| development/C/cold-source-2-group-tree/viewToEditable | 30 | 48.35 | 57.51 | 40.70 | 58.60 |
| development/C/hot-source-2-group-tree/clickToActivation | 30 | 181.05 | 184.02 | 180.20 | 185.20 |
| development/C/hot-source-2-group-tree/activationToReadEnd | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-2-group-tree/readEndToSession | 30 | 0.20 | 0.30 | 0.10 | 0.40 |
| development/C/hot-source-2-group-tree/sessionToView | 30 | 462.35 | 487.01 | 448.30 | 500.70 |
| development/C/hot-source-2-group-tree/viewToEditable | 30 | 515.65 | 553.28 | 506.10 | 566.40 |
| development/C/hot-source-2-group-tab/clickToActivation | 30 | 0.10 | 0.20 | 0.10 | 0.30 |
| development/C/hot-source-2-group-tab/activationToReadEnd | 30 | 0.00 | 0.00 | 0.00 | 0.00 |
| development/C/hot-source-2-group-tab/readEndToSession | 30 | 0.10 | 0.20 | 0.00 | 0.30 |
| development/C/hot-source-2-group-tab/sessionToView | 30 | 463.10 | 497.17 | 448.10 | 503.30 |
| development/C/hot-source-2-group-tab/viewToEditable | 30 | 519.00 | 539.77 | 504.60 | 545.60 |

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

本轮全部生产 C 的范围为 854.80–2173.00 ms；开发 C 为 875.60–2743.30 ms。未命中 250–400 ms 时，D 的 count=0、分位数为空，保留该结果，不用 B 的展开时长或小规模试跑代替正式切换。

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
| development/C/cold-rich-1-group-tree | 30 | 3.00 | 8.00 | 2.00 | 15.00 |
| development/C/hot-rich-1-group-tree | 30 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/hot-rich-1-group-tab | 30 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/cold-rich-2-group-tree | 30 | 3.00 | 7.00 | 2.00 | 7.00 |
| development/C/hot-rich-2-group-tree | 30 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/hot-rich-2-group-tab | 30 | 1.00 | 1.00 | 1.00 | 1.00 |
| development/C/cold-source-1-group-tree | 30 | 3.00 | 6.75 | 2.00 | 10.00 |
| development/C/hot-source-1-group-tree | 30 | 2.00 | 2.55 | 1.00 | 3.00 |
| development/C/hot-source-1-group-tab | 30 | 1.00 | 2.00 | 1.00 | 2.00 |
| development/C/cold-source-2-group-tree | 30 | 3.00 | 9.00 | 2.00 | 10.00 |
| development/C/hot-source-2-group-tree | 30 | 2.00 | 2.55 | 1.00 | 3.00 |
| development/C/hot-source-2-group-tab | 30 | 1.00 | 2.00 | 1.00 | 3.00 |

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
| development/C/cold-rich-1-group-tree//api/storage/user/action | 23 | 25.10 | 37.59 | 13.10 | 43.30 |
| development/C/cold-rich-1-group-tree//api/workspace-files/read | 30 | 14.40 | 19.41 | 11.30 | 22.90 |
| development/C/cold-rich-1-group-tree//api/storage/project/action | 78 | 16.15 | 46.89 | 10.20 | 1035.80 |
| development/C/cold-rich-1-group-tree//_nuxt/components/editor-workbench/MarkdownEditorView.vue | 2 | 537.20 | 956.06 | 71.80 | 1002.60 |
| development/C/cold-rich-1-group-tree//_nuxt/__uno.css | 1 | 1013.50 | 1013.50 | 1013.50 | 1013.50 |
| development/C/cold-rich-1-group-tree//_nuxt/components/markdown-studio/MarkdownCommentFlowPanel.vue | 1 | 989.50 | 989.50 | 989.50 | 989.50 |
| development/C/cold-rich-1-group-tree//_nuxt/composables/useMarkdownEditorController.ts | 1 | 992.70 | 992.70 | 992.70 | 992.70 |
| development/C/hot-rich-1-group-tree//api/storage/project/action | 30 | 15.90 | 19.47 | 14.60 | 37.10 |
| development/C/hot-rich-1-group-tab//api/storage/project/action | 30 | 15.60 | 20.43 | 14.10 | 21.50 |
| development/C/cold-rich-2-group-tree//api/storage/project/action | 71 | 15.10 | 24.25 | 9.30 | 26.90 |
| development/C/cold-rich-2-group-tree//api/workspace-files/read | 30 | 13.75 | 17.28 | 9.90 | 19.50 |
| development/C/cold-rich-2-group-tree//api/storage/user/action | 16 | 21.05 | 27.07 | 13.40 | 27.60 |
| development/C/hot-rich-2-group-tree//api/storage/project/action | 30 | 15.60 | 22.04 | 14.40 | 22.60 |
| development/C/hot-rich-2-group-tab//api/storage/project/action | 30 | 15.65 | 19.26 | 14.40 | 21.40 |
| development/C/cold-source-1-group-tree//api/storage/user/action | 8 | 29.30 | 35.09 | 11.30 | 35.30 |
| development/C/cold-source-1-group-tree//api/workspace-files/read | 30 | 12.25 | 17.05 | 9.30 | 21.10 |
| development/C/cold-source-1-group-tree//api/storage/project/action | 57 | 15.80 | 26.58 | 8.60 | 40.80 |
| development/C/cold-source-1-group-tree//_nuxt/components/editor-workbench/CodeEditorView.vue | 1 | 28.10 | 28.10 | 28.10 | 28.10 |
| development/C/hot-source-1-group-tree//api/storage/project/action | 49 | 14.80 | 21.18 | 8.90 | 34.10 |
| development/C/hot-source-1-group-tree//api/storage/user/action | 2 | 10.55 | 11.23 | 9.80 | 11.30 |
| development/C/hot-source-1-group-tab//api/storage/project/action | 36 | 15.30 | 20.80 | 9.30 | 26.30 |
| development/C/hot-source-1-group-tab//api/storage/user/action | 1 | 13.50 | 13.50 | 13.50 | 13.50 |
| development/C/cold-source-2-group-tree//api/workspace-files/read | 30 | 10.90 | 14.86 | 9.40 | 22.10 |
| development/C/cold-source-2-group-tree//api/storage/project/action | 74 | 14.60 | 21.51 | 8.70 | 41.00 |
| development/C/cold-source-2-group-tree//api/storage/user/action | 13 | 24.20 | 26.60 | 8.90 | 26.90 |
| development/C/hot-source-2-group-tree//api/storage/project/action | 46 | 14.65 | 18.05 | 9.00 | 19.60 |
| development/C/hot-source-2-group-tree//api/storage/user/action | 3 | 11.20 | 16.51 | 9.30 | 17.10 |
| development/C/hot-source-2-group-tab//api/storage/project/action | 41 | 15.50 | 19.10 | 9.50 | 20.20 |
| development/C/hot-source-2-group-tab//api/storage/user/action | 1 | 13.70 | 13.70 | 13.70 | 13.70 |

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
| development/C/cold-rich-1-group-tree//api/storage/user/action | 23 | 143.00 | 286.00 | 143.00 | 286.00 |
| development/C/cold-rich-1-group-tree//api/workspace-files/read | 30 | 14549.00 | 30402.05 | 5515.00 | 30745.00 |
| development/C/cold-rich-1-group-tree//api/storage/project/action | 78 | 143.00 | 825.00 | 128.00 | 825.00 |
| development/C/cold-rich-1-group-tree//_nuxt/components/editor-workbench/MarkdownEditorView.vue | 2 | 18423.50 | 23666.45 | 12598.00 | 24249.00 |
| development/C/cold-rich-1-group-tree//_nuxt/__uno.css | 1 | 6839854.00 | 6839854.00 | 6839854.00 | 6839854.00 |
| development/C/cold-rich-1-group-tree//_nuxt/components/markdown-studio/MarkdownCommentFlowPanel.vue | 1 | 25826.00 | 25826.00 | 25826.00 | 25826.00 |
| development/C/cold-rich-1-group-tree//_nuxt/composables/useMarkdownEditorController.ts | 1 | 4205.00 | 4205.00 | 4205.00 | 4205.00 |
| development/C/hot-rich-1-group-tree//api/storage/project/action | 30 | 128.00 | 128.00 | 128.00 | 128.00 |
| development/C/hot-rich-1-group-tab//api/storage/project/action | 30 | 128.00 | 128.00 | 128.00 | 128.00 |
| development/C/cold-rich-2-group-tree//api/storage/project/action | 71 | 143.00 | 2116.00 | 128.00 | 2116.00 |
| development/C/cold-rich-2-group-tree//api/workspace-files/read | 30 | 16335.00 | 29294.45 | 6121.00 | 30371.00 |
| development/C/cold-rich-2-group-tree//api/storage/user/action | 16 | 143.00 | 286.00 | 143.00 | 286.00 |
| development/C/hot-rich-2-group-tree//api/storage/project/action | 30 | 128.00 | 128.00 | 128.00 | 128.00 |
| development/C/hot-rich-2-group-tab//api/storage/project/action | 30 | 128.00 | 128.00 | 128.00 | 128.00 |
| development/C/cold-source-1-group-tree//api/storage/user/action | 8 | 143.00 | 286.00 | 143.00 | 286.00 |
| development/C/cold-source-1-group-tree//api/workspace-files/read | 30 | 14551.00 | 30403.50 | 5518.00 | 30747.00 |
| development/C/cold-source-1-group-tree//api/storage/project/action | 57 | 128.00 | 825.00 | 128.00 | 825.00 |
| development/C/cold-source-1-group-tree//_nuxt/components/editor-workbench/CodeEditorView.vue | 1 | 16435.00 | 16435.00 | 16435.00 | 16435.00 |
| development/C/hot-source-1-group-tree//api/storage/project/action | 49 | 128.00 | 998.00 | 128.00 | 998.00 |
| development/C/hot-source-1-group-tree//api/storage/user/action | 2 | 143.00 | 143.00 | 143.00 | 143.00 |
| development/C/hot-source-1-group-tab//api/storage/project/action | 36 | 128.00 | 998.00 | 128.00 | 998.00 |
| development/C/hot-source-1-group-tab//api/storage/user/action | 1 | 143.00 | 143.00 | 143.00 | 143.00 |
| development/C/cold-source-2-group-tree//api/workspace-files/read | 30 | 16336.50 | 29296.45 | 6123.00 | 30373.00 |
| development/C/cold-source-2-group-tree//api/storage/project/action | 74 | 143.00 | 2116.00 | 128.00 | 2116.00 |
| development/C/cold-source-2-group-tree//api/storage/user/action | 13 | 143.00 | 286.00 | 143.00 | 286.00 |
| development/C/hot-source-2-group-tree//api/storage/project/action | 46 | 128.00 | 2289.00 | 128.00 | 2289.00 |
| development/C/hot-source-2-group-tree//api/storage/user/action | 3 | 143.00 | 143.00 | 143.00 | 143.00 |
| development/C/hot-source-2-group-tab//api/storage/project/action | 41 | 128.00 | 2289.00 | 128.00 | 2289.00 |
| development/C/hot-source-2-group-tab//api/storage/user/action | 1 | 143.00 | 143.00 | 143.00 | 143.00 |

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
| development/C/cold-rich-1-group-tree//api/storage/user/action | 23 | 22.50 | 35.56 | 11.10 | 36.20 |
| development/C/cold-rich-1-group-tree//api/workspace-files/read | 30 | 12.55 | 17.41 | 9.30 | 21.00 |
| development/C/cold-rich-1-group-tree//api/storage/project/action | 78 | 14.55 | 36.30 | 7.60 | 1032.50 |
| development/C/cold-rich-1-group-tree//_nuxt/components/editor-workbench/MarkdownEditorView.vue | 2 | 37.15 | 66.89 | 4.10 | 70.20 |
| development/C/cold-rich-1-group-tree//_nuxt/__uno.css | 1 | 949.70 | 949.70 | 949.70 | 949.70 |
| development/C/cold-rich-1-group-tree//_nuxt/components/markdown-studio/MarkdownCommentFlowPanel.vue | 1 | 984.20 | 984.20 | 984.20 | 984.20 |
| development/C/cold-rich-1-group-tree//_nuxt/composables/useMarkdownEditorController.ts | 1 | 985.30 | 985.30 | 985.30 | 985.30 |
| development/C/hot-rich-1-group-tree//api/storage/project/action | 30 | 14.65 | 17.96 | 13.20 | 35.30 |
| development/C/hot-rich-1-group-tab//api/storage/project/action | 30 | 14.10 | 19.13 | 13.00 | 19.90 |
| development/C/cold-rich-2-group-tree//api/storage/project/action | 71 | 13.40 | 22.45 | 8.10 | 24.60 |
| development/C/cold-rich-2-group-tree//api/workspace-files/read | 30 | 11.75 | 15.28 | 8.40 | 16.70 |
| development/C/cold-rich-2-group-tree//api/storage/user/action | 16 | 18.75 | 25.45 | 11.20 | 25.60 |
| development/C/hot-rich-2-group-tree//api/storage/project/action | 30 | 14.25 | 20.35 | 13.20 | 21.10 |
| development/C/hot-rich-2-group-tab//api/storage/project/action | 30 | 14.20 | 17.90 | 13.00 | 20.10 |
| development/C/cold-source-1-group-tree//api/storage/user/action | 8 | 10.65 | 23.27 | 9.80 | 23.30 |
| development/C/cold-source-1-group-tree//api/workspace-files/read | 30 | 10.35 | 15.15 | 7.70 | 19.30 |
| development/C/cold-source-1-group-tree//api/storage/project/action | 57 | 14.40 | 24.28 | 7.40 | 39.10 |
| development/C/cold-source-1-group-tree//_nuxt/components/editor-workbench/CodeEditorView.vue | 1 | 26.20 | 26.20 | 26.20 | 26.20 |
| development/C/hot-source-1-group-tree//api/storage/project/action | 49 | 13.30 | 19.08 | 7.60 | 32.50 |
| development/C/hot-source-1-group-tree//api/storage/user/action | 2 | 8.75 | 9.15 | 8.30 | 9.20 |
| development/C/hot-source-1-group-tab//api/storage/project/action | 36 | 13.90 | 19.12 | 7.90 | 24.60 |
| development/C/hot-source-1-group-tab//api/storage/user/action | 1 | 11.90 | 11.90 | 11.90 | 11.90 |
| development/C/cold-source-2-group-tree//api/workspace-files/read | 30 | 9.05 | 12.56 | 7.50 | 13.20 |
| development/C/cold-source-2-group-tree//api/storage/project/action | 74 | 13.10 | 19.94 | 7.50 | 38.70 |
| development/C/cold-source-2-group-tree//api/storage/user/action | 13 | 22.30 | 22.96 | 7.60 | 23.20 |
| development/C/hot-source-2-group-tree//api/storage/project/action | 46 | 13.15 | 16.53 | 7.50 | 18.10 |
| development/C/hot-source-2-group-tree//api/storage/user/action | 3 | 9.70 | 14.92 | 7.90 | 15.50 |
| development/C/hot-source-2-group-tab//api/storage/project/action | 41 | 14.00 | 17.70 | 8.10 | 18.70 |
| development/C/hot-source-2-group-tab//api/storage/user/action | 1 | 12.10 | 12.10 | 12.10 | 12.10 |

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
| development/C/cold-rich-1-group-tree//api/storage/user/action | 23 | 1.30 | 2.75 | 0.70 | 5.00 |
| development/C/cold-rich-1-group-tree//api/workspace-files/read | 30 | 0.95 | 1.20 | 0.80 | 1.30 |
| development/C/cold-rich-1-group-tree//api/storage/project/action | 78 | 0.90 | 1.63 | 0.70 | 2.50 |
| development/C/cold-rich-1-group-tree//_nuxt/components/editor-workbench/MarkdownEditorView.vue | 2 | 3.80 | 6.23 | 1.10 | 6.50 |
| development/C/cold-rich-1-group-tree//_nuxt/__uno.css | 1 | 63.00 | 63.00 | 63.00 | 63.00 |
| development/C/cold-rich-1-group-tree//_nuxt/components/markdown-studio/MarkdownCommentFlowPanel.vue | 1 | 4.20 | 4.20 | 4.20 | 4.20 |
| development/C/cold-rich-1-group-tree//_nuxt/composables/useMarkdownEditorController.ts | 1 | 6.10 | 6.10 | 6.10 | 6.10 |
| development/C/hot-rich-1-group-tree//api/storage/project/action | 30 | 0.90 | 1.30 | 0.60 | 1.50 |
| development/C/hot-rich-1-group-tab//api/storage/project/action | 30 | 0.80 | 1.26 | 0.70 | 1.40 |
| development/C/cold-rich-2-group-tree//api/storage/project/action | 71 | 0.90 | 1.45 | 0.70 | 1.60 |
| development/C/cold-rich-2-group-tree//api/workspace-files/read | 30 | 1.00 | 1.40 | 0.90 | 1.50 |
| development/C/cold-rich-2-group-tree//api/storage/user/action | 16 | 1.30 | 2.05 | 0.60 | 2.20 |
| development/C/hot-rich-2-group-tree//api/storage/project/action | 30 | 0.80 | 1.10 | 0.70 | 1.30 |
| development/C/hot-rich-2-group-tab//api/storage/project/action | 30 | 0.80 | 1.06 | 0.60 | 1.10 |
| development/C/cold-source-1-group-tree//api/storage/user/action | 8 | 1.25 | 2.36 | 0.70 | 2.50 |
| development/C/cold-source-1-group-tree//api/workspace-files/read | 30 | 1.00 | 1.45 | 0.80 | 1.60 |
| development/C/cold-source-1-group-tree//api/storage/project/action | 57 | 0.90 | 1.66 | 0.70 | 2.20 |
| development/C/cold-source-1-group-tree//_nuxt/components/editor-workbench/CodeEditorView.vue | 1 | 1.30 | 1.30 | 1.30 | 1.30 |
| development/C/hot-source-1-group-tree//api/storage/project/action | 49 | 0.90 | 1.46 | 0.70 | 1.70 |
| development/C/hot-source-1-group-tree//api/storage/user/action | 2 | 1.05 | 1.28 | 0.80 | 1.30 |
| development/C/hot-source-1-group-tab//api/storage/project/action | 36 | 0.90 | 1.25 | 0.70 | 1.50 |
| development/C/hot-source-1-group-tab//api/storage/user/action | 1 | 1.10 | 1.10 | 1.10 | 1.10 |
| development/C/cold-source-2-group-tree//api/workspace-files/read | 30 | 1.00 | 1.46 | 0.80 | 1.50 |
| development/C/cold-source-2-group-tree//api/storage/project/action | 74 | 0.90 | 1.80 | 0.70 | 2.60 |
| development/C/cold-source-2-group-tree//api/storage/user/action | 13 | 1.60 | 3.22 | 0.80 | 3.70 |
| development/C/hot-source-2-group-tree//api/storage/project/action | 46 | 0.90 | 1.10 | 0.70 | 1.20 |
| development/C/hot-source-2-group-tree//api/storage/user/action | 3 | 0.80 | 0.80 | 0.70 | 0.80 |
| development/C/hot-source-2-group-tab//api/storage/project/action | 41 | 0.90 | 1.10 | 0.60 | 1.40 |
| development/C/hot-source-2-group-tab//api/storage/user/action | 1 | 1.00 | 1.00 | 1.00 | 1.00 |

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
| development/C/cold-rich-1-group-tree/files.read.resolve | 30 | 0.60 | 1.00 | 0.40 | 1.90 |
| development/C/cold-rich-1-group-tree/files.read.read | 30 | 2.10 | 3.42 | 1.60 | 4.80 |
| development/C/cold-rich-2-group-tree/files.read.resolve | 30 | 0.60 | 1.00 | 0.40 | 3.20 |
| development/C/cold-rich-2-group-tree/files.read.read | 30 | 2.05 | 4.04 | 1.60 | 5.20 |
| development/C/cold-source-1-group-tree/files.read.resolve | 30 | 0.50 | 2.11 | 0.30 | 4.20 |
| development/C/cold-source-1-group-tree/files.read.read | 30 | 1.80 | 2.80 | 1.50 | 3.00 |
| development/C/cold-source-2-group-tree/files.read.resolve | 30 | 0.50 | 2.71 | 0.30 | 4.20 |
| development/C/cold-source-2-group-tree/files.read.read | 30 | 1.60 | 2.60 | 1.40 | 2.80 |

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
| development/C/cold-rich-1-group-tree/files.activation | 30 | 957.60 | 1025.41 | 884.00 | 1185.50 |
| development/C/cold-rich-1-group-tree/files.activation.read | 30 | 445.05 | 490.65 | 430.40 | 534.20 |
| development/C/cold-rich-1-group-tree/editor.session.publish | 30 | 0.10 | 0.25 | 0.00 | 0.30 |
| development/C/cold-rich-1-group-tree/editor.tiptap.create | 30 | 515.70 | 576.63 | 78.70 | 633.10 |
| development/C/cold-rich-1-group-tree/editor.tiptap.initialize | 30 | 505.65 | 565.91 | 31.20 | 620.70 |
| development/C/cold-rich-1-group-tree/editor.view.publish | 30 | 0.10 | 0.20 | 0.00 | 0.20 |
| development/C/hot-rich-1-group-tree/editor.session.publish | 30 | 0.10 | 0.20 | 0.00 | 0.20 |
| development/C/hot-rich-1-group-tree/files.activation | 30 | 448.65 | 466.59 | 433.50 | 467.50 |
| development/C/hot-rich-1-group-tree/editor.view.publish | 30 | 0.10 | 0.16 | 0.00 | 0.20 |
| development/C/hot-rich-1-group-tab/editor.session.publish | 30 | 0.10 | 0.16 | 0.00 | 0.20 |
| development/C/hot-rich-1-group-tab/files.activation | 30 | 443.40 | 468.60 | 435.50 | 494.20 |
| development/C/hot-rich-1-group-tab/editor.view.publish | 30 | 0.10 | 0.10 | 0.00 | 0.20 |
| development/C/cold-rich-2-group-tree/files.activation.read | 30 | 445.60 | 457.46 | 431.90 | 491.40 |
| development/C/cold-rich-2-group-tree/files.activation | 30 | 906.30 | 936.53 | 871.80 | 993.80 |
| development/C/cold-rich-2-group-tree/editor.session.publish | 30 | 0.20 | 0.30 | 0.00 | 0.30 |
| development/C/cold-rich-2-group-tree/editor.tiptap.create | 30 | 465.10 | 520.62 | 455.50 | 541.80 |
| development/C/cold-rich-2-group-tree/editor.tiptap.initialize | 30 | 451.25 | 505.44 | 441.70 | 528.60 |
| development/C/cold-rich-2-group-tree/editor.view.publish | 30 | 0.10 | 0.20 | 0.00 | 0.20 |
| development/C/hot-rich-2-group-tree/editor.session.publish | 30 | 0.25 | 0.30 | 0.20 | 0.40 |
| development/C/hot-rich-2-group-tree/files.activation | 30 | 448.80 | 460.79 | 438.20 | 504.60 |
| development/C/hot-rich-2-group-tree/editor.view.publish | 30 | 0.00 | 0.10 | 0.00 | 0.10 |
| development/C/hot-rich-2-group-tab/editor.session.publish | 30 | 0.10 | 0.20 | 0.00 | 0.30 |
| development/C/hot-rich-2-group-tab/files.activation | 30 | 453.00 | 479.31 | 439.30 | 489.30 |
| development/C/hot-rich-2-group-tab/editor.view.publish | 30 | 0.10 | 0.20 | 0.00 | 0.20 |
| development/C/cold-source-1-group-tree/files.activation.read | 30 | 478.60 | 489.85 | 466.70 | 501.70 |
| development/C/cold-source-1-group-tree/files.activation | 30 | 958.60 | 995.51 | 937.20 | 1001.70 |
| development/C/cold-source-1-group-tree/editor.session.publish | 30 | 0.10 | 0.20 | 0.00 | 0.20 |
| development/C/cold-source-1-group-tree/editor.monaco.mount | 30 | 478.50 | 500.02 | 425.80 | 514.10 |
| development/C/cold-source-1-group-tree/editor.monaco.model | 30 | 0.30 | 0.65 | 0.20 | 7.30 |
| development/C/cold-source-1-group-tree/editor.monaco.create | 30 | 4.95 | 6.57 | 4.10 | 399.10 |
| development/C/cold-source-1-group-tree/editor.view.publish | 30 | 0.10 | 0.10 | 0.00 | 0.10 |
| development/C/hot-source-1-group-tree/editor.session.publish | 30 | 0.10 | 0.20 | 0.00 | 0.20 |
| development/C/hot-source-1-group-tree/files.activation | 30 | 477.55 | 503.24 | 465.70 | 595.70 |
| development/C/hot-source-1-group-tree/editor.view.publish | 30 | 0.00 | 0.10 | 0.00 | 0.20 |
| development/C/hot-source-1-group-tab/editor.session.publish | 30 | 0.10 | 0.10 | 0.00 | 0.10 |
| development/C/hot-source-1-group-tab/files.activation | 30 | 479.25 | 492.89 | 465.80 | 497.20 |
| development/C/hot-source-1-group-tab/editor.view.publish | 30 | 0.10 | 0.16 | 0.00 | 0.20 |
| development/C/cold-source-2-group-tree/files.activation.read | 30 | 477.10 | 494.77 | 465.30 | 528.40 |
| development/C/cold-source-2-group-tree/files.activation | 30 | 952.85 | 990.60 | 933.80 | 1017.50 |
| development/C/cold-source-2-group-tree/editor.session.publish | 30 | 0.15 | 0.25 | 0.10 | 0.30 |
| development/C/cold-source-2-group-tree/editor.monaco.mount | 30 | 473.75 | 494.00 | 466.70 | 502.80 |
| development/C/cold-source-2-group-tree/editor.monaco.model | 30 | 0.30 | 0.40 | 0.20 | 0.40 |
| development/C/cold-source-2-group-tree/editor.monaco.create | 30 | 5.50 | 7.41 | 4.80 | 12.60 |
| development/C/cold-source-2-group-tree/editor.view.publish | 30 | 0.10 | 0.10 | 0.00 | 0.10 |
| development/C/hot-source-2-group-tree/editor.session.publish | 30 | 0.20 | 0.30 | 0.10 | 0.40 |
| development/C/hot-source-2-group-tree/files.activation | 30 | 482.65 | 508.43 | 468.70 | 520.90 |
| development/C/hot-source-2-group-tree/editor.view.publish | 30 | 0.10 | 0.20 | 0.00 | 0.20 |
| development/C/hot-source-2-group-tab/editor.session.publish | 30 | 0.10 | 0.20 | 0.00 | 0.30 |
| development/C/hot-source-2-group-tab/files.activation | 30 | 482.45 | 518.12 | 469.90 | 524.90 |
| development/C/hot-source-2-group-tab/editor.view.publish | 30 | 0.10 | 0.16 | 0.00 | 0.20 |

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
| development/C/cold-rich-1-group-tree | 30 | 951.50 | 1033.05 | 876.00 | 1172.00 |
| development/C/hot-rich-1-group-tree | 30 | 880.00 | 920.40 | 866.00 | 927.00 |
| development/C/hot-rich-1-group-tab | 30 | 882.00 | 907.00 | 862.00 | 973.00 |
| development/C/cold-rich-2-group-tree | 30 | 898.50 | 965.65 | 875.00 | 971.00 |
| development/C/hot-rich-2-group-tree | 30 | 880.50 | 899.95 | 864.00 | 930.00 |
| development/C/hot-rich-2-group-tab | 30 | 893.00 | 940.15 | 874.00 | 954.00 |
| development/C/cold-source-1-group-tree | 30 | 963.50 | 995.60 | 939.00 | 1002.00 |
| development/C/hot-source-1-group-tree | 30 | 943.00 | 986.05 | 925.00 | 1156.00 |
| development/C/hot-source-1-group-tab | 30 | 945.50 | 967.75 | 930.00 | 984.00 |
| development/C/cold-source-2-group-tree | 30 | 955.50 | 987.05 | 938.00 | 994.00 |
| development/C/hot-source-2-group-tree | 30 | 946.00 | 984.30 | 918.00 | 1035.00 |
| development/C/hot-source-2-group-tab | 30 | 952.50 | 995.65 | 933.00 | 1004.00 |

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

- 固定种子 42017，生成 3000 个 Markdown，5120–30720 bytes，合成文件共 52769090 bytes；root: 1 (0.03%)；lorebook: 899 (29.97%)；manuscript: 999 (33.30%)；notes: 1101 (36.70%)。产品创建时的默认模板文件保留，fileCount/totalBytes 只统计生成器。普通主体目录深度 3–5 层；index.md 与宽目录是明确的浅层入口。
- 用真实 POST /api/projects 创建项目后写入返回 projectRoot 对应的隔离 State Root；项目卡片的真实 click 发起打开。rich 与 source 使用不同项目，避免旧标签与分组恢复污染。
- 起止判定：{"percentile":"线性插值，位置 (n-1)*p；仅成功且输入验证通过的样本进入统计","tree":"click 捕获事件至三个根目录已渲染、可命中，连续两个动画帧成立","directory":"直接子行全部渲染、展开动画结束，连续两个动画帧成立","editor":"当前活动组目标标签选中、正确标记出现在可见编辑器、输入可写且不 busy；连续两个动画帧成立；窗口外输入并撤销","cold":"A 每次重启服务；C 每次用该项目中从未打开的文件；不清 OS 页缓存","desktop":"桌面版未测"}。
- 样本统计保留 Resource Timing、Server-Timing、固定名字的 User Timing measure、Long Tasks、Long Animation Frames 原始条目；每个样本记录 loadAverage。常驻计时不生成 mark 或序号名字。
- 环境：{"hostname":"archlinux","platform":"linux","arch":"x64","bun":"1.4.2","cpuModel":"Intel(R) Core(TM) i5-1035G1 CPU @ 1.00GHz","cpuCount":8,"memoryBytes":16429027328,"chrome":"151.0.7922.71","loadAtStart":[0.88,1.11,1.05],"loadAtEnd":[2.06,1.69,1.5],"viewport":{"width":1440,"height":1000},"headless":true}。
- State Root：/tmp/neuro-book/t42-files-baseline-0YP7fl/state；样本、State Root 与独立 Chrome profile 已清理=true；仅超限 profiling 文件留存=[]。
- 构建日志：/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-build.log；命令与逐次服务启动日志与报告同目录。

- 生产矩阵续跑来源：{"reportPath":"/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-start-failure/baseline-report.json","generatedAt":"2026-10-03T06:05:28.121Z","sourceRevision":"a7346d225d48b8496078001a5ddfa656da85e827","sourceCompleted":false,"sourceDiagnostics":["Error: development 启动失败；详见 /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-development-11.log\n    at startProduct (/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/packages/neuro-book/scripts/perf/files-baseline.ts:160:19)\n    at async restart (/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/packages/neuro-book/scripts/perf/files-baseline.ts:219:25)\n    at async main (/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/packages/neuro-book/scripts/perf/files-baseline.ts:422:19)\n    at processTicksAndRejections (native:7:39)"],"environment":{"hostname":"archlinux","platform":"linux","arch":"x64","bun":"1.4.2","cpuModel":"Intel(R) Core(TM) i5-1035G1 CPU @ 1.00GHz","cpuCount":8,"memoryBytes":16429027328,"chrome":"151.0.7922.71","loadAtStart":[0.55,0.81,0.75],"loadAtEnd":[1.28,1.27,1.22],"viewport":{"width":1440,"height":1000},"headless":true},"stateCleaned":true,"rawCount":410}。历史失败不计为本轮诊断，原报告与 raw 保持原样；本轮只补开发 C 与代表项目打开 profiling。

## 跟踪与 CPU 采样

| 运行 | 采样对象 | CPU 样本数 | 分类采样区间 ms | 原始文件 |
|---|---|---:|---|---|
| baseline-directory-expand | browser | 490 | {"未归类 CPU":319.9709999999998,"空闲或原生未归类":17.173000000000002,"垃圾回收":133.25599999999991} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-start-failure/baseline-directory-expand.cpuprofile (42985 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-start-failure/baseline-directory-expand.trace.json (943340 bytes) |
| baseline-production-rich-1-group | browser | 1553 | {"未归类 CPU":237.81299993896482,"空闲或原生未归类":113.769,"Vue 深度遍历":1190.2120000000007,"垃圾回收":10.936,"富文本控件与视图":6.479000000000001,"Monaco 模型与控件":1.091} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-start-failure/baseline-production-rich-1-group.cpuprofile (173487 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-start-failure/baseline-production-rich-1-group.trace.json (566263 bytes) |
| baseline-production-rich-2-group | browser | 1576 | {"未归类 CPU":254.57999993896485,"空闲或原生未归类":99.68000000000002,"Vue 深度遍历":1180.3349999999978,"垃圾回收":16.333,"富文本控件与视图":5.736,"Monaco 模型与控件":2.136} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-start-failure/baseline-production-rich-2-group.cpuprofile (165424 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-start-failure/baseline-production-rich-2-group.trace.json (544812 bytes) |
| baseline-production-source-1-group | browser | 1599 | {"未归类 CPU":271.54899999999986,"空闲或原生未归类":107.99199999999999,"Vue 深度遍历":1196.0539999999992,"垃圾回收":14.116000000000001,"Monaco 模型与控件":10.646,"富文本控件与视图":1.088,"Vue 更新":7.955} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-start-failure/baseline-production-source-1-group.cpuprofile (149368 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-start-failure/baseline-production-source-1-group.trace.json (612265 bytes) |
| baseline-production-source-2-group | browser | 1614 | {"未归类 CPU":270.7089999999999,"空闲或原生未归类":97.14199999999998,"Vue 深度遍历":1211.9140000000007,"垃圾回收":16.490000000000002,"Monaco 模型与控件":6.082000000000001,"Vue 更新":7.963} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-start-failure/baseline-production-source-2-group.cpuprofile (161639 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-start-failure/baseline-production-source-2-group.trace.json (413659 bytes) |
| baseline-development-rich-1-group | browser | 1599 | {"未归类 CPU":141.16999999999987,"Vue 更新":123.66899999999997,"空闲或原生未归类":100.88199999999995,"Vue 深度遍历":1207.7849999999987,"垃圾回收":15.319000000000003,"富文本控件与视图":18.975} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-development-rich-1-group.cpuprofile (287731 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-development-rich-1-group.trace.json (598815 bytes) |
| baseline-development-rich-2-group | browser | 1649 | {"未归类 CPU":127.90799999999997,"Vue 更新":128.97299999999993,"空闲或原生未归类":99.90299999999996,"富文本控件与视图":28.449,"Vue 深度遍历":1246.319999999999,"垃圾回收":13.365999999999998,"富文本解析与模型":1.081} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-development-rich-2-group.cpuprofile (346431 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-development-rich-2-group.trace.json (533344 bytes) |
| baseline-development-source-1-group | browser | 1667 | {"Vue 更新":120.79100000000001,"未归类 CPU":117.99699999999997,"空闲或原生未归类":113.38399999999999,"Vue 深度遍历":1279.415,"垃圾回收":16.613000000000003,"富文本控件与视图":11.442999999999998,"富文本解析与模型":1.081,"Monaco 模型与控件":39.675999999999995} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-development-source-1-group.cpuprofile (300236 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-development-source-1-group.trace.json (702215 bytes) |
| baseline-development-source-2-group | browser | 1736 | {"未归类 CPU":137.759,"Vue 更新":145.71799999999996,"空闲或原生未归类":105.52799999999998,"Vue 深度遍历":1301.559,"垃圾回收":15.738,"Monaco 模型与控件":51.606000000000016,"富文本控件与视图":7.792} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-development-source-2-group.cpuprofile (389747 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-development-source-2-group.trace.json (435996 bytes) |
| baseline-project-open | browser | 7161 | {"未归类 CPU":905.905000000001,"空闲或原生未归类":3891.5220000000027,"Vue 深度遍历":1725.6240000000007,"垃圾回收":127.44899999999996} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-project-open.cpuprofile (561579 bytes)；/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-project-open.trace.json (2626661 bytes) |
| baseline-server-project-open | server | 2648 | {"未归类 CPU":4223.3240000000005,"frontmatter 与 YAML":1791.858,"垃圾回收":1.169,"目录与索引（含路径校验）":578.9559999999997,"文件读取 CPU":14.812999999999999,"索引问题校验":40.38} | /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/baseline-server-project-open.cpuprofile (1012444 bytes) |

### 服务代表窗口构成

| 代表运行与类别 | 分类采样区间 ms | 占打开窗口 |
|---|---:|---:|
| baseline-server-project-open/未归类 CPU | 4223.32 | 63.50% |
| baseline-server-project-open/frontmatter 与 YAML | 1791.86 | 26.94% |
| baseline-server-project-open/垃圾回收 | 1.17 | 0.02% |
| baseline-server-project-open/目录与索引（含路径校验） | 578.96 | 8.71% |
| baseline-server-project-open/文件读取 CPU | 14.81 | 0.22% |
| baseline-server-project-open/索引问题校验 | 40.38 | 0.61% |

这些类别分配相邻采样时间戳区间，不是精确 CPU 活跃时间；原生、异步 I/O 与稀疏采样间隔仍可能归到当前栈，未归类不自动解释为 CPU 或磁盘。服务 timeDeltas 原值与 topFunctions 保留在 JSON/profile，复核时不能仅凭压缩名认定热点。

### 切换代表窗口的 Vue 深度遍历

| 代表运行 | 操作窗口 ms | traverse 分类采样区间 ms | 占窗口 |
|---|---:|---:|---:|
| baseline-production-rich-1-group | 1560.30 | 1190.21 | 76.28% |
| baseline-production-rich-2-group | 1558.80 | 1180.33 | 75.72% |
| baseline-production-source-1-group | 1609.40 | 1196.05 | 74.32% |
| baseline-production-source-2-group | 1610.30 | 1211.91 | 75.26% |
| baseline-development-rich-1-group | 1607.80 | 1207.78 | 75.12% |
| baseline-development-rich-2-group | 1646.00 | 1246.32 | 75.72% |
| baseline-development-source-1-group | 1700.40 | 1279.41 | 75.24% |
| baseline-development-source-2-group | 1765.70 | 1301.56 | 73.71% |

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
