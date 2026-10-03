# Files 现状耗时基线

生成时间：2026-10-03T10:35:17.350Z；HEAD：a7346d225d48b8496078001a5ddfa656da85e827；生产镜像身份详见 JSON build.image。

完整运行：通过；有效样本 140/140。桌面版未测。

## A. 打开项目

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold | 5 | 1216.60 | 1270.74 | 1148.30 | 1273.10 |
| production/A/reopen | 5 | 1017.90 | 1041.74 | 1002.90 | 1043.20 |

服务冷开每次重启自有 Product；reopen 在同进程内关闭并再次打开。两者都会经历真实 Project Session 生命周期，OS 页缓存保持自然状态。

### 打开项目的互斥区间

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| service-cold/点击至 open 响应结束 | 5 | 173.10 | 183.56 | 161.60 | 185.70 |
| service-cold/open 响应结束至 tree 响应结束 | 5 | 751.20 | 808.36 | 707.40 | 818.20 |
| service-cold/tree 响应结束至可操作 | 5 | 290.40 | 303.40 | 279.30 | 306.60 |
| reopen/点击至 open 响应结束 | 5 | 188.70 | 195.72 | 165.20 | 196.60 |
| reopen/open 响应结束至 tree 响应结束 | 5 | 564.20 | 575.26 | 530.80 | 577.90 |
| reopen/tree 响应结束至可操作 | 5 | 285.10 | 289.54 | 276.20 | 289.80 |

三个区间在同一样本内相加等于打开总耗时；各列分位数不能相加。open 接口只等 required 模块 minimum-ready，File Index 在后台共享 warm-up，tree 请求等待完整快照。接口 wall-clock、frontmatter CPU 采样与前端 User Timing 分开解释。

### 前端投影与建树

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold/files.tree.project | 5 | 8.90 | 9.94 | 8.40 | 10.10 |
| production/A/service-cold/files.tree.build | 5 | 1.70 | 2.10 | 1.50 | 2.20 |
| production/A/reopen/files.tree.project | 5 | 8.60 | 9.78 | 7.30 | 9.80 |
| production/A/reopen/files.tree.build | 5 | 1.60 | 1.96 | 1.40 | 2.00 |

tree 响应结束至可操作还包含 JSON 解码、响应状态提交、Vue 更新、DOM 渲染和两帧确认；不能把整个残余区间标为建树或纯渲染。代表 Chrome profile 与 Layout/UpdateLayoutTree/Paint 原始跟踪见下文。

## B. 展开宽目录

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/B/notes-wide | 10 | 286.05 | 303.00 | 276.60 | 308.40 |

目录 notes/wide/ 直接包含 100 项。终点包括所有直接子行挂载与展开动画完成。最长完整 Long Task：

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/B/notes-wide | 10 | 0.00 | 0.00 | 0.00 | 0.00 |

当前服务发布完整 tree；B 是已收到快照的客户端展开，不新增按需目录协议。请求数见 JSON，不把零 tree 请求解释为已实现按需扫描。

## C. 点击至正文可编辑

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/C/cold-rich-1-group-tree | 10 | 414.20 | 479.97 | 396.90 | 516.60 |
| production/C/hot-rich-1-group-tree | 10 | 322.20 | 334.19 | 314.80 | 340.40 |
| production/C/hot-rich-1-group-tab | 10 | 145.70 | 160.84 | 132.30 | 165.70 |
| production/C/cold-rich-2-group-tree | 10 | 410.40 | 417.10 | 402.50 | 418.00 |
| production/C/hot-rich-2-group-tree | 10 | 323.90 | 334.32 | 318.50 | 335.00 |
| production/C/hot-rich-2-group-tab | 10 | 143.75 | 148.85 | 136.40 | 149.30 |
| production/C/cold-source-1-group-tree | 10 | 432.05 | 541.12 | 409.80 | 617.80 |
| production/C/hot-source-1-group-tree | 10 | 349.50 | 353.90 | 332.60 | 354.30 |
| production/C/hot-source-1-group-tab | 10 | 161.50 | 171.29 | 152.70 | 173.90 |
| production/C/cold-source-2-group-tree | 10 | 432.20 | 441.47 | 419.60 | 441.70 |
| production/C/hot-source-2-group-tree | 10 | 345.90 | 359.65 | 339.60 | 360.10 |
| production/C/hot-source-2-group-tab | 10 | 170.85 | 201.53 | 156.20 | 206.30 |

cold 是项目内首次打开的不同文件。hot-tree 从文件树单击两个已保留标签的文件；hot-tab 从标签按钮切换。富文本／源码、单组／双组独立记录，预热与 profiling 不进入常规统计。

热切换 80 次期间 stat/read 请求合计 0；是否重建控件由固定 User Timing measure 与独立 CPU profile 交叉核对。没有 read 请求的热标签延迟不能归因服务端读文件。

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

### 选中与标签反馈

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/C/cold-rich-1-group-tree/selectionMs | 10 | 6.70 | 8.22 | 1.80 | 8.40 |
| production/C/cold-rich-1-group-tree/tabMs | 10 | 388.45 | 405.40 | 374.30 | 405.40 |
| production/C/hot-rich-1-group-tree/selectionMs | 10 | 4.00 | 8.82 | 1.80 | 9.00 |
| production/C/hot-rich-1-group-tree/tabMs | 10 | 312.85 | 324.75 | 306.80 | 330.20 |
| production/C/hot-rich-1-group-tab/selectionMs | 10 | 135.70 | 151.34 | 122.90 | 155.80 |
| production/C/hot-rich-1-group-tab/tabMs | 10 | 135.70 | 151.34 | 122.90 | 155.80 |
| production/C/cold-rich-2-group-tree/selectionMs | 10 | 5.80 | 8.29 | 1.90 | 8.70 |
| production/C/cold-rich-2-group-tree/tabMs | 10 | 387.85 | 391.37 | 376.90 | 391.60 |
| production/C/hot-rich-2-group-tree/selectionMs | 10 | 3.85 | 7.26 | 1.80 | 7.80 |
| production/C/hot-rich-2-group-tree/tabMs | 10 | 316.10 | 325.26 | 311.60 | 325.30 |
| production/C/hot-rich-2-group-tab/selectionMs | 10 | 134.65 | 140.68 | 128.60 | 141.40 |
| production/C/hot-rich-2-group-tab/tabMs | 10 | 134.65 | 140.68 | 128.60 | 141.40 |
| production/C/cold-source-1-group-tree/selectionMs | 10 | 6.75 | 7.55 | 3.90 | 7.60 |
| production/C/cold-source-1-group-tree/tabMs | 10 | 389.95 | 400.23 | 378.00 | 404.10 |
| production/C/hot-source-1-group-tree/selectionMs | 10 | 2.95 | 7.98 | 2.00 | 8.70 |
| production/C/hot-source-1-group-tree/tabMs | 10 | 319.30 | 322.87 | 310.00 | 323.50 |
| production/C/hot-source-1-group-tab/selectionMs | 10 | 136.35 | 144.72 | 129.70 | 148.00 |
| production/C/hot-source-1-group-tab/tabMs | 10 | 136.35 | 144.72 | 129.70 | 148.00 |
| production/C/cold-source-2-group-tree/selectionMs | 10 | 5.35 | 8.02 | 2.10 | 8.70 |
| production/C/cold-source-2-group-tree/tabMs | 10 | 397.20 | 403.52 | 386.40 | 404.10 |
| production/C/hot-source-2-group-tree/selectionMs | 10 | 5.25 | 8.23 | 2.10 | 8.50 |
| production/C/hot-source-2-group-tree/tabMs | 10 | 320.45 | 332.36 | 311.20 | 336.50 |
| production/C/hot-source-2-group-tab/selectionMs | 10 | 143.90 | 175.20 | 135.30 | 177.90 |
| production/C/hot-source-2-group-tab/tabMs | 10 | 143.90 | 175.20 | 135.30 | 177.90 |

### 互斥关键路径区间

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/C/cold-rich-1-group-tree/clickToActivation | 10 | 180.40 | 181.04 | 180.30 | 181.40 |
| production/C/cold-rich-1-group-tree/activationToReadEnd | 10 | 15.10 | 20.10 | 9.40 | 22.30 |
| production/C/cold-rich-1-group-tree/readEndToSession | 10 | 55.05 | 62.71 | 44.90 | 62.80 |
| production/C/cold-rich-1-group-tree/sessionToView | 10 | 139.15 | 192.47 | 135.50 | 224.60 |
| production/C/cold-rich-1-group-tree/viewToEditable | 10 | 21.95 | 35.61 | 19.20 | 43.40 |
| production/C/hot-rich-1-group-tree/clickToActivation | 10 | 180.30 | 180.40 | 180.20 | 180.40 |
| production/C/hot-rich-1-group-tree/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tree/readEndToSession | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-rich-1-group-tree/sessionToView | 10 | 58.70 | 69.16 | 53.90 | 75.10 |
| production/C/hot-rich-1-group-tree/viewToEditable | 10 | 82.60 | 86.46 | 80.30 | 86.60 |
| production/C/hot-rich-1-group-tab/clickToActivation | 10 | 0.10 | 0.16 | 0.00 | 0.20 |
| production/C/hot-rich-1-group-tab/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tab/readEndToSession | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-rich-1-group-tab/sessionToView | 10 | 59.70 | 70.32 | 54.00 | 75.90 |
| production/C/hot-rich-1-group-tab/viewToEditable | 10 | 84.05 | 94.28 | 78.10 | 98.10 |
| production/C/cold-rich-2-group-tree/clickToActivation | 10 | 180.30 | 180.45 | 180.20 | 180.50 |
| production/C/cold-rich-2-group-tree/activationToReadEnd | 10 | 12.80 | 16.80 | 9.20 | 17.70 |
| production/C/cold-rich-2-group-tree/readEndToSession | 10 | 58.80 | 62.01 | 49.00 | 63.00 |
| production/C/cold-rich-2-group-tree/sessionToView | 10 | 139.85 | 143.68 | 136.50 | 143.90 |
| production/C/cold-rich-2-group-tree/viewToEditable | 10 | 19.50 | 21.73 | 16.90 | 22.00 |
| production/C/hot-rich-2-group-tree/clickToActivation | 10 | 180.35 | 180.50 | 180.20 | 180.50 |
| production/C/hot-rich-2-group-tree/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tree/readEndToSession | 10 | 0.15 | 0.30 | 0.10 | 0.30 |
| production/C/hot-rich-2-group-tree/sessionToView | 10 | 60.45 | 68.21 | 56.90 | 68.80 |
| production/C/hot-rich-2-group-tree/viewToEditable | 10 | 82.45 | 92.99 | 78.00 | 94.30 |
| production/C/hot-rich-2-group-tab/clickToActivation | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-rich-2-group-tab/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tab/readEndToSession | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-rich-2-group-tab/sessionToView | 10 | 59.80 | 61.16 | 52.90 | 61.20 |
| production/C/hot-rich-2-group-tab/viewToEditable | 10 | 83.50 | 88.36 | 80.90 | 88.90 |
| production/C/cold-source-1-group-tree/clickToActivation | 10 | 180.40 | 181.07 | 180.30 | 181.30 |
| production/C/cold-source-1-group-tree/activationToReadEnd | 10 | 9.40 | 13.72 | 7.70 | 13.90 |
| production/C/cold-source-1-group-tree/readEndToSession | 10 | 57.65 | 63.18 | 46.30 | 63.40 |
| production/C/cold-source-1-group-tree/sessionToView | 10 | 131.05 | 228.94 | 125.30 | 300.80 |
| production/C/cold-source-1-group-tree/viewToEditable | 10 | 50.30 | 68.02 | 33.90 | 75.90 |
| production/C/hot-source-1-group-tree/clickToActivation | 10 | 180.40 | 180.50 | 180.30 | 180.50 |
| production/C/hot-source-1-group-tree/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tree/readEndToSession | 10 | 0.10 | 0.16 | 0.00 | 0.20 |
| production/C/hot-source-1-group-tree/sessionToView | 10 | 59.55 | 64.76 | 52.90 | 65.30 |
| production/C/hot-source-1-group-tree/viewToEditable | 10 | 107.70 | 111.84 | 97.50 | 113.10 |
| production/C/hot-source-1-group-tab/clickToActivation | 10 | 0.10 | 0.20 | 0.10 | 0.20 |
| production/C/hot-source-1-group-tab/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tab/readEndToSession | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-source-1-group-tab/sessionToView | 10 | 56.55 | 64.03 | 54.10 | 64.70 |
| production/C/hot-source-1-group-tab/viewToEditable | 10 | 101.30 | 110.76 | 96.30 | 111.80 |
| production/C/cold-source-2-group-tree/clickToActivation | 10 | 180.35 | 180.46 | 180.20 | 180.50 |
| production/C/cold-source-2-group-tree/activationToReadEnd | 10 | 13.15 | 20.82 | 8.80 | 22.80 |
| production/C/cold-source-2-group-tree/readEndToSession | 10 | 58.60 | 64.73 | 53.70 | 66.30 |
| production/C/cold-source-2-group-tree/sessionToView | 10 | 133.50 | 139.37 | 125.80 | 139.60 |
| production/C/cold-source-2-group-tree/viewToEditable | 10 | 45.85 | 51.18 | 34.20 | 52.30 |
| production/C/hot-source-2-group-tree/clickToActivation | 10 | 180.30 | 180.36 | 180.20 | 180.40 |
| production/C/hot-source-2-group-tree/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tree/readEndToSession | 10 | 0.10 | 0.26 | 0.00 | 0.30 |
| production/C/hot-source-2-group-tree/sessionToView | 10 | 57.25 | 64.57 | 55.20 | 68.40 |
| production/C/hot-source-2-group-tree/viewToEditable | 10 | 107.60 | 119.13 | 100.60 | 119.40 |
| production/C/hot-source-2-group-tab/clickToActivation | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-source-2-group-tab/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tab/readEndToSession | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-source-2-group-tab/sessionToView | 10 | 58.45 | 68.92 | 54.80 | 74.50 |
| production/C/hot-source-2-group-tab/viewToEditable | 10 | 111.15 | 134.69 | 99.20 | 137.30 |

这些区间按时间线单调切分，相加等于该操作总耗时。无 read 的 hot 样本不虚构网络阶段。控件与解析 measure 是嵌套子阶段，不能再次相加。

files.activation.read 虽然只包 read await，仍包含主线程排队、响应解码与 Promise continuation；与 Resource Timing 读请求时长不同。TipTap initialize 是解析/模型/控件与 onCreate 调度联合区间；Monaco mount 包括模块等待、nextTick/layout。它们不能解释成纯解析或纯创建。

## D. 约 0.3 秒延迟

生产已出现 250–400 ms 操作，共 41 个；对应原始 C 样本 ID 保存在 reproduction.sampleIds，未复制样本充当新测量。

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| 生产 250–400 ms 样本 | 41 | 335.00 | 359.10 | 314.80 | 396.90 |

代表样本：production-C-cold-rich-1-group-tree-3。

| 区间 | 耗时 ms |
|---|---:|
| 点击至 activation（含单击等待） | 180.30 |
| activation 至 read 响应末尾 | 9.40 |
| 响应末尾至 session 发布 | 50.50 |
| session 至 view 发布 | 137.50 |
| view 发布至可编辑并跨帧确认 | 19.20 |

开发模式对照：生产已复现，本轮未要求开发对照。

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| 开发 250–400 ms 样本 | 0 | 未取得 | 未取得 | 未取得 | 未取得 |

开发代表样本：未取得。

| 区间 | 耗时 ms |
|---|---:|

本轮全部生产 C 的范围为 132.30–617.80 ms；开发 C 为 未取得–未取得 ms。未命中 250–400 ms 时，D 的 count=0、分位数为空，保留该结果，不用 B 的展开时长或小规模试跑代替正式切换。

## 与 t16、t24 的可比性

t16/t24 在 Windows、Chromium 151.0.7922.34、Source Dev、1440×1000 下测两个 8 KiB permanent 标签，3×30 次；t24 富文本单组 p50/p95=33.5/38.0 ms，源码单组=43.5/53.8 ms。本轮是 Linux、headless Chrome、生产构建、约 3000 个 5–30 KiB 文件，每格 30 次，输入证明逐样本进行。视口和 capture-click 起点相同，但构建、平台、文件大小、工程规模与跨帧终点不同，不能直接计算回归幅度。

仅 hot-tab 的入口与历史标签切换对应；hot-tree 保留既有 180 ms 单击等待，不与 t24 标签值直接比较。双组 hot-tab 也保留为补充，本轮要求的单组富文本／源码两格均有独立样本。

## 网络与阶段分解

### 每次操作请求总数（单位：次）

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold | 5 | 33.00 | 33.80 | 31.00 | 34.00 |
| production/A/reopen | 5 | 32.00 | 32.00 | 32.00 | 32.00 |
| production/B/notes-wide | 10 | 2.00 | 4.65 | 2.00 | 6.00 |
| production/C/cold-rich-1-group-tree | 10 | 3.00 | 4.55 | 2.00 | 5.00 |
| production/C/hot-rich-1-group-tree | 10 | 1.00 | 4.00 | 1.00 | 4.00 |
| production/C/hot-rich-1-group-tab | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/cold-rich-2-group-tree | 10 | 2.50 | 3.00 | 2.00 | 3.00 |
| production/C/hot-rich-2-group-tree | 10 | 1.00 | 1.55 | 1.00 | 2.00 |
| production/C/hot-rich-2-group-tab | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/cold-source-1-group-tree | 10 | 3.50 | 5.65 | 2.00 | 7.00 |
| production/C/hot-source-1-group-tree | 10 | 1.00 | 2.55 | 1.00 | 3.00 |
| production/C/hot-source-1-group-tab | 10 | 1.00 | 1.55 | 1.00 | 2.00 |
| production/C/cold-source-2-group-tree | 10 | 3.00 | 3.55 | 2.00 | 4.00 |
| production/C/hot-source-2-group-tree | 10 | 1.00 | 3.10 | 1.00 | 4.00 |
| production/C/hot-source-2-group-tab | 10 | 1.00 | 2.00 | 1.00 | 2.00 |

### 每个请求耗时

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 5 | 7.20 | 7.28 | 5.90 | 7.30 |
| production/A/service-cold//api/config/bootstrap | 15 | 11.70 | 24.92 | 6.60 | 25.90 |
| production/A/service-cold//api/projects/open | 5 | 124.90 | 128.84 | 123.50 | 129.40 |
| production/A/service-cold//api/storage/user/context | 20 | 25.85 | 34.03 | 21.40 | 34.70 |
| production/A/service-cold//favicon.ico | 5 | 15.40 | 22.16 | 14.70 | 22.70 |
| production/A/service-cold//api/projects | 5 | 11.20 | 14.56 | 9.10 | 15.20 |
| production/A/service-cold//api/workspace-files/tree | 5 | 720.20 | 776.34 | 681.80 | 784.60 |
| production/A/service-cold//api/storage/user/action | 46 | 41.75 | 64.03 | 8.30 | 70.20 |
| production/A/service-cold//api/storage/project/context | 10 | 51.60 | 62.34 | 47.00 | 63.20 |
| production/A/service-cold//api/storage/project/action | 46 | 36.75 | 60.73 | 8.90 | 66.20 |
| production/A/reopen//api/auth/me | 5 | 9.90 | 15.90 | 7.80 | 16.20 |
| production/A/reopen//api/config/bootstrap | 15 | 14.70 | 22.11 | 6.70 | 24.00 |
| production/A/reopen//api/projects/open | 5 | 134.90 | 139.70 | 125.00 | 140.50 |
| production/A/reopen//api/storage/user/context | 20 | 24.65 | 27.25 | 20.10 | 28.20 |
| production/A/reopen//favicon.ico | 5 | 18.70 | 21.12 | 16.20 | 21.70 |
| production/A/reopen//api/storage/user/action | 50 | 31.15 | 111.92 | 19.70 | 115.60 |
| production/A/reopen//api/projects | 5 | 9.90 | 24.76 | 7.10 | 27.30 |
| production/A/reopen//api/workspace-files/tree | 5 | 534.20 | 546.82 | 503.60 | 549.90 |
| production/A/reopen//api/storage/project/context | 10 | 40.20 | 44.67 | 36.80 | 44.90 |
| production/A/reopen//api/storage/project/action | 40 | 34.05 | 39.87 | 15.90 | 43.00 |
| production/B/notes-wide//api/storage/user/action | 21 | 10.40 | 25.30 | 7.00 | 32.20 |
| production/B/notes-wide//api/storage/project/action | 4 | 27.30 | 31.18 | 10.10 | 31.30 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 10 | 14.50 | 18.99 | 9.10 | 20.70 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 12.50 | 12.50 | 12.50 | 12.50 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 11.40 | 11.40 | 11.40 | 11.40 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 17 | 14.00 | 20.96 | 8.50 | 26.40 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 2 | 17.05 | 19.71 | 14.10 | 20.00 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 14 | 15.60 | 22.37 | 11.70 | 22.50 |
| production/C/hot-rich-1-group-tree//api/storage/user/action | 2 | 23.25 | 23.66 | 22.80 | 23.70 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 10 | 15.40 | 21.64 | 12.80 | 23.80 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 10 | 12.40 | 16.15 | 8.80 | 17.00 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 15 | 13.20 | 17.60 | 9.50 | 17.60 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 11 | 14.80 | 21.30 | 8.70 | 22.90 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 10 | 15.60 | 19.95 | 11.70 | 20.80 |
| production/C/cold-source-1-group-tree//api/storage/user/action | 1 | 16.60 | 16.60 | 16.60 | 16.60 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 10 | 9.05 | 12.75 | 7.30 | 13.20 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 15.50 | 15.50 | 15.50 | 15.50 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 21 | 12.40 | 18.20 | 8.30 | 19.20 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 7.30 | 7.30 | 7.30 | 7.30 |
| production/C/cold-source-1-group-tree//_nuxt/editor.worker-CdQrwHl8.js | 3 | -3.20 | -3.02 | -3.40 | -3.00 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 14 | 15.30 | 17.69 | 8.60 | 19.70 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 11 | 15.50 | 18.45 | 9.30 | 18.50 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 10 | 12.70 | 20.31 | 8.50 | 22.20 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 18 | 12.25 | 17.14 | 8.10 | 19.10 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 14 | 14.45 | 18.46 | 8.70 | 19.50 |
| production/C/hot-source-2-group-tree//api/storage/user/action | 2 | 17.30 | 17.93 | 16.60 | 18.00 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 13 | 14.20 | 31.48 | 8.40 | 49.90 |

### 每个请求响应体大小（单位：bytes，encodedBodySize）

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 5 | 113.00 | 113.00 | 113.00 | 113.00 |
| production/A/service-cold//api/config/bootstrap | 15 | 302.00 | 302.00 | 301.00 | 302.00 |
| production/A/service-cold//api/projects/open | 5 | 275.00 | 275.00 | 275.00 | 275.00 |
| production/A/service-cold//api/storage/user/context | 20 | 48.50 | 80.00 | 17.00 | 80.00 |
| production/A/service-cold//favicon.ico | 5 | 78.00 | 78.00 | 78.00 | 78.00 |
| production/A/service-cold//api/projects | 5 | 210.00 | 210.00 | 210.00 | 210.00 |
| production/A/service-cold//api/workspace-files/tree | 5 | 498370.00 | 498370.00 | 498370.00 | 498370.00 |
| production/A/service-cold//api/storage/user/action | 46 | 98.00 | 98.00 | 48.00 | 98.00 |
| production/A/service-cold//api/storage/project/context | 10 | 80.00 | 80.00 | 80.00 | 80.00 |
| production/A/service-cold//api/storage/project/action | 46 | 98.00 | 104.00 | 48.00 | 104.00 |
| production/A/reopen//api/auth/me | 5 | 113.00 | 113.00 | 113.00 | 113.00 |
| production/A/reopen//api/config/bootstrap | 15 | 302.00 | 302.00 | 301.00 | 302.00 |
| production/A/reopen//api/projects/open | 5 | 275.00 | 275.00 | 275.00 | 275.00 |
| production/A/reopen//api/storage/user/context | 20 | 48.50 | 80.00 | 17.00 | 80.00 |
| production/A/reopen//favicon.ico | 5 | 78.00 | 78.00 | 78.00 | 78.00 |
| production/A/reopen//api/storage/user/action | 50 | 98.00 | 98.00 | 48.00 | 98.00 |
| production/A/reopen//api/projects | 5 | 210.00 | 210.00 | 210.00 | 210.00 |
| production/A/reopen//api/workspace-files/tree | 5 | 498370.00 | 498370.00 | 498370.00 | 498370.00 |
| production/A/reopen//api/storage/project/context | 10 | 80.00 | 80.00 | 80.00 | 80.00 |
| production/A/reopen//api/storage/project/action | 40 | 98.00 | 343.00 | 48.00 | 343.00 |
| production/B/notes-wide//api/storage/user/action | 21 | 104.00 | 191.00 | 98.00 | 191.00 |
| production/B/notes-wide//api/storage/project/action | 4 | 98.00 | 306.25 | 98.00 | 343.00 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 10 | 19682.00 | 28366.70 | 12166.00 | 29030.00 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 9845.00 | 9845.00 | 9845.00 | 9845.00 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 184.00 | 184.00 | 184.00 | 184.00 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 17 | 104.00 | 446.00 | 104.00 | 446.00 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 2 | 144.50 | 186.35 | 98.00 | 191.00 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 14 | 104.00 | 104.00 | 98.00 | 104.00 |
| production/C/hot-rich-1-group-tree//api/storage/user/action | 2 | 98.00 | 98.00 | 98.00 | 98.00 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 10 | 104.00 | 104.00 | 104.00 | 104.00 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 10 | 10371.50 | 26210.40 | 5733.00 | 26394.00 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 15 | 104.00 | 1007.00 | 104.00 | 1007.00 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 11 | 104.00 | 104.00 | 98.00 | 104.00 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 10 | 104.00 | 104.00 | 104.00 | 104.00 |
| production/C/cold-source-1-group-tree//api/storage/user/action | 1 | 98.00 | 98.00 | 98.00 | 98.00 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 10 | 19684.00 | 28368.70 | 12168.00 | 29032.00 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 2210.00 | 2210.00 | 2210.00 | 2210.00 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 21 | 104.00 | 446.00 | 98.00 | 446.00 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 3650.00 | 3650.00 | 3650.00 | 3650.00 |
| production/C/cold-source-1-group-tree//_nuxt/editor.worker-CdQrwHl8.js | 3 | 251810.00 | 251810.00 | 251810.00 | 251810.00 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 14 | 104.00 | 529.00 | 98.00 | 529.00 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 11 | 104.00 | 316.50 | 104.00 | 529.00 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 10 | 10373.50 | 26212.40 | 5735.00 | 26396.00 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 18 | 104.00 | 1007.00 | 104.00 | 1007.00 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 14 | 104.00 | 1090.00 | 104.00 | 1090.00 |
| production/C/hot-source-2-group-tree//api/storage/user/action | 2 | 98.00 | 98.00 | 98.00 | 98.00 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 13 | 104.00 | 1090.00 | 104.00 | 1090.00 |

### 首字节等待（服务执行与排队均在此内）

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 5 | 5.70 | 5.88 | 4.50 | 5.90 |
| production/A/service-cold//api/config/bootstrap | 15 | 10.20 | 23.17 | 5.20 | 24.50 |
| production/A/service-cold//api/projects/open | 5 | 123.10 | 127.34 | 121.90 | 128.00 |
| production/A/service-cold//api/storage/user/context | 20 | 23.95 | 32.30 | 19.90 | 32.30 |
| production/A/service-cold//favicon.ico | 5 | 13.70 | 18.80 | 13.30 | 18.90 |
| production/A/service-cold//api/projects | 5 | 9.10 | 12.48 | 7.60 | 13.10 |
| production/A/service-cold//api/workspace-files/tree | 5 | 717.30 | 773.80 | 679.60 | 782.00 |
| production/A/service-cold//api/storage/user/action | 46 | 35.25 | 46.38 | 7.10 | 51.00 |
| production/A/service-cold//api/storage/project/context | 10 | 47.00 | 51.68 | 35.00 | 52.80 |
| production/A/service-cold//api/storage/project/action | 46 | 33.25 | 49.13 | 7.60 | 64.60 |
| production/A/reopen//api/auth/me | 5 | 8.50 | 14.18 | 6.20 | 14.50 |
| production/A/reopen//api/config/bootstrap | 15 | 12.80 | 20.14 | 5.50 | 22.10 |
| production/A/reopen//api/projects/open | 5 | 133.40 | 138.16 | 122.90 | 138.90 |
| production/A/reopen//api/storage/user/context | 20 | 22.35 | 25.37 | 18.60 | 26.70 |
| production/A/reopen//favicon.ico | 5 | 17.10 | 17.84 | 14.50 | 18.00 |
| production/A/reopen//api/storage/user/action | 50 | 29.30 | 109.23 | 17.80 | 112.40 |
| production/A/reopen//api/projects | 5 | 8.50 | 22.14 | 5.80 | 24.60 |
| production/A/reopen//api/workspace-files/tree | 5 | 532.00 | 544.18 | 501.40 | 547.20 |
| production/A/reopen//api/storage/project/context | 10 | 38.35 | 42.61 | 35.30 | 42.70 |
| production/A/reopen//api/storage/project/action | 40 | 32.00 | 38.16 | 14.10 | 40.00 |
| production/B/notes-wide//api/storage/user/action | 21 | 8.70 | 15.90 | 6.00 | 28.40 |
| production/B/notes-wide//api/storage/project/action | 4 | 24.30 | 28.61 | 8.00 | 28.80 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 10 | 12.10 | 16.87 | 7.50 | 18.40 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 9.00 | 9.00 | 9.00 | 9.00 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 9.90 | 9.90 | 9.90 | 9.90 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 17 | 12.60 | 19.40 | 7.30 | 25.00 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 2 | 14.85 | 17.14 | 12.30 | 17.40 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 14 | 13.95 | 20.23 | 10.50 | 20.30 |
| production/C/hot-rich-1-group-tree//api/storage/user/action | 2 | 19.95 | 19.99 | 19.90 | 20.00 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 10 | 14.05 | 20.15 | 11.40 | 22.40 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 10 | 10.75 | 13.94 | 6.90 | 14.80 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 15 | 12.00 | 15.71 | 8.00 | 16.20 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 11 | 13.40 | 19.65 | 7.40 | 21.30 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 10 | 14.30 | 18.52 | 10.40 | 19.20 |
| production/C/cold-source-1-group-tree//api/storage/user/action | 1 | 14.10 | 14.10 | 14.10 | 14.10 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 10 | 7.15 | 10.54 | 6.10 | 10.90 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 13.90 | 13.90 | 13.90 | 13.90 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 21 | 11.10 | 16.70 | 6.90 | 17.70 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 5.90 | 5.90 | 5.90 | 5.90 |
| production/C/cold-source-1-group-tree//_nuxt/editor.worker-CdQrwHl8.js | 3 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 14 | 13.75 | 16.19 | 7.40 | 18.40 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 11 | 14.20 | 17.10 | 8.00 | 17.10 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 10 | 10.90 | 18.35 | 6.60 | 20.10 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 18 | 11.10 | 15.53 | 6.90 | 17.40 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 14 | 13.05 | 16.90 | 7.40 | 18.00 |
| production/C/hot-source-2-group-tree//api/storage/user/action | 2 | 14.70 | 15.69 | 13.60 | 15.80 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 13 | 12.90 | 28.80 | 7.00 | 45.00 |

### 响应体传输

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 5 | 0.90 | 1.06 | 0.80 | 1.10 |
| production/A/service-cold//api/config/bootstrap | 15 | 1.10 | 1.30 | 0.90 | 1.30 |
| production/A/service-cold//api/projects/open | 5 | 1.20 | 1.28 | 0.90 | 1.30 |
| production/A/service-cold//api/storage/user/context | 20 | 1.15 | 2.41 | 0.90 | 2.50 |
| production/A/service-cold//favicon.ico | 5 | 0.90 | 2.94 | 0.80 | 3.40 |
| production/A/service-cold//api/projects | 5 | 1.20 | 1.30 | 0.90 | 1.30 |
| production/A/service-cold//api/workspace-files/tree | 5 | 2.00 | 2.38 | 1.70 | 2.40 |
| production/A/service-cold//api/storage/user/action | 46 | 1.20 | 2.20 | 0.70 | 2.20 |
| production/A/service-cold//api/storage/project/context | 10 | 1.35 | 2.17 | 0.70 | 2.30 |
| production/A/service-cold//api/storage/project/action | 46 | 1.05 | 2.00 | 0.70 | 3.10 |
| production/A/reopen//api/auth/me | 5 | 1.00 | 1.18 | 0.90 | 1.20 |
| production/A/reopen//api/config/bootstrap | 15 | 1.10 | 1.33 | 0.90 | 1.40 |
| production/A/reopen//api/projects/open | 5 | 1.00 | 1.42 | 0.80 | 1.50 |
| production/A/reopen//api/storage/user/context | 20 | 1.20 | 2.12 | 0.80 | 2.50 |
| production/A/reopen//favicon.ico | 5 | 1.00 | 2.70 | 0.80 | 3.10 |
| production/A/reopen//api/storage/user/action | 50 | 1.70 | 3.51 | 0.70 | 4.00 |
| production/A/reopen//api/projects | 5 | 1.00 | 1.98 | 0.80 | 2.20 |
| production/A/reopen//api/workspace-files/tree | 5 | 1.90 | 2.00 | 1.50 | 2.00 |
| production/A/reopen//api/storage/project/context | 10 | 1.45 | 2.01 | 1.00 | 2.10 |
| production/A/reopen//api/storage/project/action | 40 | 1.10 | 3.02 | 0.70 | 3.90 |
| production/B/notes-wide//api/storage/user/action | 21 | 0.80 | 1.10 | 0.60 | 2.80 |
| production/B/notes-wide//api/storage/project/action | 4 | 1.70 | 2.75 | 1.00 | 2.90 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 10 | 1.00 | 1.46 | 0.90 | 1.50 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 2.90 | 2.90 | 2.90 | 2.90 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 1.10 | 1.10 | 1.10 | 1.10 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 17 | 0.80 | 1.04 | 0.70 | 1.20 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 2 | 1.55 | 2.05 | 1.00 | 2.10 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 14 | 1.00 | 1.87 | 0.80 | 2.20 |
| production/C/hot-rich-1-group-tree//api/storage/user/action | 2 | 2.75 | 3.16 | 2.30 | 3.20 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 10 | 0.85 | 1.11 | 0.70 | 1.20 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 10 | 0.95 | 1.10 | 0.80 | 1.10 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 15 | 0.90 | 1.13 | 0.70 | 1.20 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 11 | 1.00 | 1.10 | 0.70 | 1.10 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 10 | 0.80 | 1.06 | 0.70 | 1.10 |
| production/C/cold-source-1-group-tree//api/storage/user/action | 1 | 1.60 | 1.60 | 1.60 | 1.60 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 10 | 1.00 | 1.25 | 0.80 | 1.30 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 21 | 0.80 | 1.00 | 0.70 | 1.50 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 0.80 | 0.80 | 0.80 | 0.80 |
| production/C/cold-source-1-group-tree//_nuxt/editor.worker-CdQrwHl8.js | 3 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 14 | 0.90 | 1.17 | 0.70 | 1.30 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 11 | 0.90 | 1.05 | 0.70 | 1.10 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 10 | 0.95 | 1.21 | 0.80 | 1.30 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 18 | 0.95 | 1.16 | 0.70 | 1.50 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 14 | 1.05 | 1.20 | 0.70 | 1.20 |
| production/C/hot-source-2-group-tree//api/storage/user/action | 2 | 1.40 | 1.67 | 1.10 | 1.70 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 13 | 0.80 | 1.18 | 0.70 | 1.30 |

### Server-Timing

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold/auth.user | 5 | 1.10 | 1.38 | 0.80 | 1.40 |
| production/A/service-cold/config.bootstrap | 15 | 0.90 | 4.23 | 0.40 | 4.30 |
| production/A/service-cold/files.project.ref | 5 | 0.70 | 0.78 | 0.70 | 0.80 |
| production/A/service-cold/files.project.open | 5 | 103.50 | 109.16 | 101.80 | 110.50 |
| production/A/service-cold/projects.manifests | 5 | 0.10 | 0.20 | 0.10 | 0.20 |
| production/A/service-cold/projects.total | 5 | 0.10 | 0.20 | 0.10 | 0.20 |
| production/A/service-cold/files.tree.resolve | 5 | 4.80 | 6.52 | 3.60 | 6.70 |
| production/A/service-cold/files.tree.index | 5 | 687.40 | 743.88 | 652.70 | 750.60 |
| production/A/reopen/auth.user | 5 | 1.10 | 1.48 | 1.10 | 1.50 |
| production/A/reopen/config.bootstrap | 15 | 0.80 | 1.69 | 0.60 | 1.90 |
| production/A/reopen/files.project.ref | 5 | 0.20 | 0.20 | 0.20 | 0.20 |
| production/A/reopen/files.project.open | 5 | 111.70 | 115.80 | 103.10 | 115.90 |
| production/A/reopen/projects.manifests | 5 | 0.10 | 0.20 | 0.10 | 0.20 |
| production/A/reopen/projects.total | 5 | 0.20 | 0.20 | 0.10 | 0.20 |
| production/A/reopen/files.tree.resolve | 5 | 3.00 | 4.70 | 1.40 | 5.10 |
| production/A/reopen/files.tree.index | 5 | 503.50 | 521.80 | 482.50 | 523.70 |
| production/C/cold-rich-1-group-tree/files.read.resolve | 10 | 0.40 | 0.45 | 0.30 | 0.50 |
| production/C/cold-rich-1-group-tree/files.read.read | 10 | 1.85 | 2.70 | 1.60 | 2.70 |
| production/C/cold-rich-2-group-tree/files.read.resolve | 10 | 0.30 | 0.45 | 0.30 | 0.50 |
| production/C/cold-rich-2-group-tree/files.read.read | 10 | 1.80 | 2.06 | 1.60 | 2.10 |
| production/C/cold-source-1-group-tree/files.read.resolve | 10 | 0.30 | 0.35 | 0.20 | 0.40 |
| production/C/cold-source-1-group-tree/files.read.read | 10 | 1.60 | 2.16 | 1.40 | 2.20 |
| production/C/cold-source-2-group-tree/files.read.resolve | 10 | 0.30 | 0.55 | 0.20 | 0.60 |
| production/C/cold-source-2-group-tree/files.read.read | 10 | 1.75 | 1.95 | 1.40 | 2.00 |

### User Timing

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold/files.tree.client | 5 | 728.10 | 784.52 | 688.50 | 792.00 |
| production/A/service-cold/files.tree.project | 5 | 8.90 | 9.94 | 8.40 | 10.10 |
| production/A/service-cold/files.tree.build | 5 | 1.70 | 2.10 | 1.50 | 2.20 |
| production/A/reopen/files.tree.client | 5 | 541.00 | 554.12 | 510.90 | 557.10 |
| production/A/reopen/files.tree.project | 5 | 8.60 | 9.78 | 7.30 | 9.80 |
| production/A/reopen/files.tree.build | 5 | 1.60 | 1.96 | 1.40 | 2.00 |
| production/C/cold-rich-1-group-tree/files.activation | 10 | 148.35 | 163.98 | 132.80 | 165.20 |
| production/C/cold-rich-1-group-tree/files.activation.read | 10 | 69.65 | 75.53 | 59.60 | 75.80 |
| production/C/cold-rich-1-group-tree/editor.session.publish | 10 | 0.10 | 0.30 | 0.10 | 0.30 |
| production/C/cold-rich-1-group-tree/editor.tiptap.create | 10 | 79.00 | 84.16 | 54.60 | 84.30 |
| production/C/cold-rich-1-group-tree/editor.tiptap.initialize | 10 | 72.55 | 77.81 | 22.60 | 78.40 |
| production/C/cold-rich-1-group-tree/editor.view.publish | 10 | 0.10 | 0.37 | 0.00 | 0.50 |
| production/C/hot-rich-1-group-tree/editor.session.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-rich-1-group-tree/files.activation | 10 | 72.10 | 81.34 | 67.50 | 87.10 |
| production/C/hot-rich-1-group-tree/editor.view.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-rich-1-group-tab/editor.session.publish | 10 | 0.05 | 0.10 | 0.00 | 0.10 |
| production/C/hot-rich-1-group-tab/files.activation | 10 | 72.65 | 84.46 | 65.50 | 90.00 |
| production/C/hot-rich-1-group-tab/editor.view.publish | 10 | 0.05 | 0.10 | 0.00 | 0.10 |
| production/C/cold-rich-2-group-tree/files.activation.read | 10 | 69.35 | 76.01 | 62.70 | 76.10 |
| production/C/cold-rich-2-group-tree/files.activation | 10 | 143.80 | 148.21 | 136.60 | 148.30 |
| production/C/cold-rich-2-group-tree/editor.session.publish | 10 | 0.20 | 0.30 | 0.10 | 0.30 |
| production/C/cold-rich-2-group-tree/editor.tiptap.create | 10 | 80.40 | 84.61 | 76.80 | 86.50 |
| production/C/cold-rich-2-group-tree/editor.tiptap.initialize | 10 | 70.80 | 74.38 | 67.70 | 74.70 |
| production/C/cold-rich-2-group-tree/editor.view.publish | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-rich-2-group-tree/editor.session.publish | 10 | 0.10 | 0.30 | 0.10 | 0.30 |
| production/C/hot-rich-2-group-tree/files.activation | 10 | 73.70 | 80.88 | 69.30 | 81.60 |
| production/C/hot-rich-2-group-tree/editor.view.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-rich-2-group-tab/editor.session.publish | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-rich-2-group-tab/files.activation | 10 | 72.35 | 73.81 | 65.90 | 73.90 |
| production/C/hot-rich-2-group-tab/editor.view.publish | 10 | 0.00 | 0.10 | 0.00 | 0.10 |
| production/C/cold-source-1-group-tree/files.activation | 10 | 135.80 | 150.44 | 128.10 | 151.70 |
| production/C/cold-source-1-group-tree/files.activation.read | 10 | 68.85 | 71.40 | 59.10 | 71.90 |
| production/C/cold-source-1-group-tree/editor.session.publish | 10 | 0.10 | 0.26 | 0.00 | 0.30 |
| production/C/cold-source-1-group-tree/editor.monaco.mount | 10 | 69.35 | 110.63 | 66.00 | 140.60 |
| production/C/cold-source-1-group-tree/editor.monaco.model | 10 | 0.50 | 3.86 | 0.30 | 6.60 |
| production/C/cold-source-1-group-tree/editor.monaco.create | 10 | 4.85 | 68.11 | 3.40 | 118.60 |
| production/C/cold-source-1-group-tree/editor.view.publish | 10 | 0.10 | 0.26 | 0.00 | 0.30 |
| production/C/hot-source-1-group-tree/editor.session.publish | 10 | 0.10 | 0.16 | 0.00 | 0.20 |
| production/C/hot-source-1-group-tree/files.activation | 10 | 74.70 | 82.40 | 69.80 | 82.40 |
| production/C/hot-source-1-group-tree/editor.view.publish | 10 | 0.05 | 0.16 | 0.00 | 0.20 |
| production/C/hot-source-1-group-tab/editor.session.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-source-1-group-tab/files.activation | 10 | 71.85 | 78.26 | 69.30 | 78.80 |
| production/C/hot-source-1-group-tab/editor.view.publish | 10 | 0.10 | 0.16 | 0.00 | 0.20 |
| production/C/cold-source-2-group-tree/files.activation.read | 10 | 71.40 | 78.66 | 65.30 | 80.50 |
| production/C/cold-source-2-group-tree/files.activation | 10 | 138.95 | 147.58 | 133.70 | 147.90 |
| production/C/cold-source-2-group-tree/editor.session.publish | 10 | 0.20 | 0.20 | 0.10 | 0.20 |
| production/C/cold-source-2-group-tree/editor.monaco.mount | 10 | 71.80 | 76.77 | 66.70 | 76.90 |
| production/C/cold-source-2-group-tree/editor.monaco.model | 10 | 0.30 | 0.40 | 0.20 | 0.40 |
| production/C/cold-source-2-group-tree/editor.monaco.create | 10 | 4.50 | 9.25 | 3.50 | 11.00 |
| production/C/cold-source-2-group-tree/editor.view.publish | 10 | 0.00 | 0.10 | 0.00 | 0.10 |
| production/C/hot-source-2-group-tree/editor.session.publish | 10 | 0.10 | 0.26 | 0.00 | 0.30 |
| production/C/hot-source-2-group-tree/files.activation | 10 | 75.45 | 84.85 | 71.50 | 88.90 |
| production/C/hot-source-2-group-tree/editor.view.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-source-2-group-tab/editor.session.publish | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-source-2-group-tab/files.activation | 10 | 75.50 | 92.53 | 71.00 | 92.80 |
| production/C/hot-source-2-group-tab/editor.view.publish | 10 | 0.10 | 0.16 | 0.00 | 0.20 |

### 各操作最长主线程任务

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold | 5 | 274.00 | 289.20 | 267.00 | 292.00 |
| production/A/reopen | 5 | 274.00 | 276.80 | 262.00 | 277.00 |
| production/B/notes-wide | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/cold-rich-1-group-tree | 10 | 133.50 | 151.30 | 130.00 | 154.00 |
| production/C/hot-rich-1-group-tree | 10 | 130.50 | 142.60 | 124.00 | 148.00 |
| production/C/hot-rich-1-group-tab | 10 | 139.50 | 155.50 | 126.00 | 160.00 |
| production/C/cold-rich-2-group-tree | 10 | 133.50 | 137.55 | 131.00 | 138.00 |
| production/C/hot-rich-2-group-tree | 10 | 134.00 | 143.00 | 130.00 | 143.00 |
| production/C/hot-rich-2-group-tab | 10 | 138.50 | 148.75 | 132.00 | 151.00 |
| production/C/cold-source-1-group-tree | 10 | 138.00 | 154.95 | 132.00 | 159.00 |
| production/C/hot-source-1-group-tree | 10 | 137.00 | 141.10 | 128.00 | 142.00 |
| production/C/hot-source-1-group-tab | 10 | 139.00 | 147.65 | 133.00 | 149.00 |
| production/C/cold-source-2-group-tree | 10 | 140.50 | 148.55 | 133.00 | 149.00 |
| production/C/hot-source-2-group-tree | 10 | 138.50 | 150.40 | 129.00 | 154.00 |
| production/C/hot-source-2-group-tab | 10 | 145.50 | 178.20 | 137.00 | 180.00 |

## 性能标准对照

采用 p95 与规范时限作对照；规范本身没有指定分位数，因此本表是报告约定，不是改写产品合同。

| 变体 | 规范时限 ms | 实测 p95 ms | 结果 |
|---|---:|---:|---|
| production/A/service-cold | 1000 | 1270.74 | p95 超出 |
| production/A/reopen | 300 | 1041.74 | p95 超出 |
| production/C/cold-rich-1-group-tree | 200 | 479.97 | p95 超出 |
| production/C/hot-rich-1-group-tree | 100 | 334.19 | p95 超出 |
| production/C/hot-rich-1-group-tab | 100 | 160.84 | p95 超出 |
| production/C/cold-rich-2-group-tree | 200 | 417.10 | p95 超出 |
| production/C/hot-rich-2-group-tree | 100 | 334.32 | p95 超出 |
| production/C/hot-rich-2-group-tab | 100 | 148.85 | p95 超出 |
| production/C/cold-source-1-group-tree | 200 | 541.12 | p95 超出 |
| production/C/hot-source-1-group-tree | 100 | 353.90 | p95 超出 |
| production/C/hot-source-1-group-tab | 100 | 171.29 | p95 超出 |
| production/C/cold-source-2-group-tree | 200 | 441.47 | p95 超出 |
| production/C/hot-source-2-group-tree | 100 | 359.65 | p95 超出 |
| production/C/hot-source-2-group-tab | 100 | 201.53 | p95 超出 |

## 测量设计与环境

- 固定种子 42017，生成 300 个 Markdown，5120–30720 bytes，合成文件共 5341556 bytes；root: 1 (0.33%)；lorebook: 89 (29.67%)；manuscript: 99 (33.00%)；notes: 111 (37.00%)。产品创建时的默认模板文件保留，fileCount/totalBytes 只统计生成器。普通主体目录深度 3–5 层；index.md 与宽目录是明确的浅层入口。
- 用真实 POST /api/projects 创建项目后写入返回 projectRoot 对应的隔离 State Root；项目卡片的真实 click 发起打开。rich 与 source 使用不同项目，避免旧标签与分组恢复污染。
- 起止判定：{"percentile":"线性插值，位置 (n-1)*p；仅成功且输入验证通过的样本进入统计","tree":"click 捕获事件至三个根目录已渲染、可命中，连续两个动画帧成立","directory":"直接子行全部渲染、展开动画结束，连续两个动画帧成立","editor":"当前活动组目标标签选中、正确标记出现在可见编辑器、输入可写且不 busy；连续两个动画帧成立；窗口外输入并撤销","cold":"A 每次重启服务；C 每次用该项目中从未打开的文件；不清 OS 页缓存","desktop":"桌面版未测"}。
- 样本统计保留 Resource Timing、Server-Timing、固定名字的 User Timing measure、Long Tasks、Long Animation Frames 原始条目；每个样本记录 loadAverage。常驻计时不生成 mark 或序号名字。
- 环境：{"hostname":"archlinux","platform":"linux","arch":"x64","bun":"1.4.2","cpuModel":"Intel(R) Core(TM) i5-1035G1 CPU @ 1.00GHz","cpuCount":8,"memoryBytes":16429027328,"chrome":"151.0.7922.71","loadAtStart":[2.2,2.13,2.06],"loadAtEnd":[3.57,2.42,2.18],"viewport":{"width":1440,"height":1000},"headless":true}。
- State Root：/tmp/neuro-book/t42-files-baseline-AoI7g4/state；样本、State Root 与独立 Chrome profile 已清理=true；仅超限 profiling 文件留存=[]。
- 构建日志：/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-300-build.log；命令与逐次服务启动日志与报告同目录。

## 跟踪与 CPU 采样

| 运行 | 采样对象 | CPU 样本数 | 分类采样区间 ms | 原始文件 |
|---|---|---:|---|---|
| accept-300-directory-expand | browser | 334 | {"未归类 CPU":126.99599999999995,"空闲或原生未归类":169.504} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-300-directory-expand.cpuprofile (26447 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-300-directory-expand.trace.json (558910 bytes) |
| accept-300-production-rich-1-group | browser | 455 | {"未归类 CPU":125.87299999999999,"空闲或原生未归类":123.74299999999994,"Vue 深度遍历":145.20899999999997,"富文本控件与视图":5.374999999999999,"垃圾回收":2.1319999999999997,"Vue 更新":1.068} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-300-production-rich-1-group.cpuprofile (169735 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-300-production-rich-1-group.trace.json (316628 bytes) |
| accept-300-production-rich-2-group | browser | 497 | {"未归类 CPU":132.673,"空闲或原生未归类":126.96499999999997,"Vue 深度遍历":154.32999999999996,"垃圾回收":3.221,"富文本控件与视图":9.763,"Vue 更新":1.081,"Monaco 模型与控件":1.067} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-300-production-rich-2-group.cpuprofile (166684 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-300-production-rich-2-group.trace.json (322480 bytes) |
| accept-300-production-source-1-group | browser | 506 | {"未归类 CPU":141.968,"空闲或原生未归类":125.35799999999996,"Vue 更新":10.021999999999998,"Vue 深度遍历":153.59699999999998,"垃圾回收":1.066,"Monaco 模型与控件":4.401,"富文本控件与视图":1.088} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-300-production-source-1-group.cpuprofile (150388 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-300-production-source-1-group.trace.json (356050 bytes) |
| accept-300-production-source-2-group | browser | 551 | {"未归类 CPU":174.76999999999984,"空闲或原生未归类":118.12299999999992,"Vue 深度遍历":170.839,"垃圾回收":5.372999999999999,"Monaco 模型与控件":14.747,"Vue 更新":9.248000000000001} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-300-production-source-2-group.cpuprofile (155217 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-300-production-source-2-group.trace.json (345050 bytes) |
| accept-300-project-open | browser | 1638 | {"未归类 CPU":426.04899999999964,"空闲或原生未归类":686.46,"Vue 深度遍历":213.636,"垃圾回收":16.855} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-300-project-open.cpuprofile (457653 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-300-project-open.trace.json (977556 bytes) |
| accept-300-server-project-open | server | 699 | {"未归类 CPU":906.1889999999997,"frontmatter 与 YAML":330.6569999999999,"垃圾回收":1.391,"目录与索引（含路径校验）":94.57900000000001,"空闲或原生未归类":1.22,"索引问题校验":8.964} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-300-server-project-open.cpuprofile (848647 bytes) |

### 服务代表窗口构成

| 代表运行与类别 | 分类采样区间 ms | 占打开窗口 |
|---|---:|---:|
| accept-300-server-project-open/未归类 CPU | 906.19 | 67.47% |
| accept-300-server-project-open/frontmatter 与 YAML | 330.66 | 24.62% |
| accept-300-server-project-open/垃圾回收 | 1.39 | 0.10% |
| accept-300-server-project-open/目录与索引（含路径校验） | 94.58 | 7.04% |
| accept-300-server-project-open/空闲或原生未归类 | 1.22 | 0.09% |
| accept-300-server-project-open/索引问题校验 | 8.96 | 0.67% |

这些类别分配相邻采样时间戳区间，不是精确 CPU 活跃时间；原生、异步 I/O 与稀疏采样间隔仍可能归到当前栈，未归类不自动解释为 CPU 或磁盘。服务 timeDeltas 原值与 topFunctions 保留在 JSON/profile，复核时不能仅凭压缩名认定热点。

### 切换代表窗口的 Vue 深度遍历

| 代表运行 | 操作窗口 ms | traverse 分类采样区间 ms | 占窗口 |
|---|---:|---:|---:|
| accept-300-production-rich-1-group | 403.40 | 145.21 | 36.00% |
| accept-300-production-rich-2-group | 429.10 | 154.33 | 35.97% |
| accept-300-production-source-1-group | 437.50 | 153.60 | 35.11% |
| accept-300-production-source-2-group | 493.10 | 170.84 | 34.65% |

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
