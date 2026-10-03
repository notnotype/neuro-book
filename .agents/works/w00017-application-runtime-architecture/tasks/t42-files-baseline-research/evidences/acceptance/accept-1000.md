# Files 现状耗时基线

生成时间：2026-10-03T10:41:17.737Z；HEAD：a7346d225d48b8496078001a5ddfa656da85e827；生产镜像身份详见 JSON build.image。

完整运行：通过；有效样本 140/140。桌面版未测。

## A. 打开项目

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold | 5 | 2829.50 | 3705.74 | 2614.10 | 3901.90 |
| production/A/reopen | 5 | 2286.20 | 3287.80 | 2177.50 | 3533.10 |

服务冷开每次重启自有 Product；reopen 在同进程内关闭并再次打开。两者都会经历真实 Project Session 生命周期，OS 页缓存保持自然状态。

### 打开项目的互斥区间

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| service-cold/点击至 open 响应结束 | 5 | 283.80 | 382.72 | 277.00 | 406.30 |
| service-cold/open 响应结束至 tree 响应结束 | 5 | 1716.40 | 2281.88 | 1583.50 | 2392.80 |
| service-cold/tree 响应结束至可操作 | 5 | 794.50 | 1049.46 | 734.80 | 1102.80 |
| reopen/点击至 open 响应结束 | 5 | 260.50 | 329.96 | 256.60 | 342.90 |
| reopen/open 响应结束至 tree 响应结束 | 5 | 1263.00 | 1969.12 | 1202.10 | 2143.50 |
| reopen/tree 响应结束至可操作 | 5 | 745.00 | 992.52 | 718.80 | 1046.70 |

三个区间在同一样本内相加等于打开总耗时；各列分位数不能相加。open 接口只等 required 模块 minimum-ready，File Index 在后台共享 warm-up，tree 请求等待完整快照。接口 wall-clock、frontmatter CPU 采样与前端 User Timing 分开解释。

### 前端投影与建树

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold/files.tree.project | 5 | 28.90 | 36.72 | 25.10 | 36.90 |
| production/A/service-cold/files.tree.build | 5 | 3.30 | 3.54 | 3.10 | 3.60 |
| production/A/reopen/files.tree.project | 5 | 27.80 | 31.16 | 23.80 | 31.20 |
| production/A/reopen/files.tree.build | 5 | 3.40 | 4.04 | 2.90 | 4.20 |

tree 响应结束至可操作还包含 JSON 解码、响应状态提交、Vue 更新、DOM 渲染和两帧确认；不能把整个残余区间标为建树或纯渲染。代表 Chrome profile 与 Layout/UpdateLayoutTree/Paint 原始跟踪见下文。

## B. 展开宽目录

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/B/notes-wide | 10 | 394.80 | 450.85 | 346.50 | 473.30 |

目录 notes/wide/ 直接包含 300 项。终点包括所有直接子行挂载与展开动画完成。最长完整 Long Task：

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/B/notes-wide | 10 | 116.50 | 160.50 | 73.00 | 174.00 |

当前服务发布完整 tree；B 是已收到快照的客户端展开，不新增按需目录协议。请求数见 JSON，不把零 tree 请求解释为已实现按需扫描。

## C. 点击至正文可编辑

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/C/cold-rich-1-group-tree | 10 | 888.85 | 1243.73 | 843.50 | 1465.90 |
| production/C/hot-rich-1-group-tree | 10 | 534.15 | 571.36 | 506.60 | 590.80 |
| production/C/hot-rich-1-group-tab | 10 | 348.05 | 364.42 | 330.60 | 364.60 |
| production/C/cold-rich-2-group-tree | 10 | 725.30 | 749.56 | 691.80 | 759.10 |
| production/C/hot-rich-2-group-tree | 10 | 512.10 | 522.82 | 506.20 | 525.30 |
| production/C/hot-rich-2-group-tab | 10 | 376.00 | 433.52 | 312.80 | 448.60 |
| production/C/cold-source-1-group-tree | 10 | 692.55 | 808.85 | 658.60 | 893.90 |
| production/C/hot-source-1-group-tree | 10 | 513.85 | 528.40 | 496.80 | 530.20 |
| production/C/hot-source-1-group-tab | 10 | 330.65 | 341.85 | 315.80 | 345.90 |
| production/C/cold-source-2-group-tree | 10 | 696.90 | 724.17 | 681.00 | 733.30 |
| production/C/hot-source-2-group-tree | 10 | 517.95 | 530.95 | 510.50 | 531.00 |
| production/C/hot-source-2-group-tab | 10 | 332.10 | 335.07 | 321.60 | 335.70 |

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
| production/C/cold-rich-1-group-tree/selectionMs | 10 | 4.10 | 5.65 | 2.80 | 5.70 |
| production/C/cold-rich-1-group-tree/tabMs | 10 | 842.20 | 1097.11 | 794.10 | 1234.90 |
| production/C/hot-rich-1-group-tree/selectionMs | 10 | 5.90 | 7.95 | 2.70 | 8.90 |
| production/C/hot-rich-1-group-tree/tabMs | 10 | 520.30 | 558.82 | 494.40 | 578.30 |
| production/C/hot-rich-1-group-tab/selectionMs | 10 | 335.10 | 347.94 | 317.70 | 350.10 |
| production/C/hot-rich-1-group-tab/tabMs | 10 | 335.10 | 347.94 | 317.70 | 350.10 |
| production/C/cold-rich-2-group-tree/selectionMs | 10 | 5.40 | 6.62 | 2.50 | 6.80 |
| production/C/cold-rich-2-group-tree/tabMs | 10 | 694.50 | 718.04 | 663.70 | 727.40 |
| production/C/hot-rich-2-group-tree/selectionMs | 10 | 2.75 | 5.51 | 2.40 | 5.60 |
| production/C/hot-rich-2-group-tree/tabMs | 10 | 503.65 | 514.02 | 498.00 | 515.60 |
| production/C/hot-rich-2-group-tab/selectionMs | 10 | 366.30 | 423.60 | 304.30 | 438.50 |
| production/C/hot-rich-2-group-tab/tabMs | 10 | 366.30 | 423.60 | 304.30 | 438.50 |
| production/C/cold-source-1-group-tree/selectionMs | 10 | 3.20 | 4.89 | 2.90 | 6.10 |
| production/C/cold-source-1-group-tree/tabMs | 10 | 647.85 | 663.05 | 630.20 | 663.90 |
| production/C/hot-source-1-group-tree/selectionMs | 10 | 3.05 | 5.32 | 2.90 | 6.80 |
| production/C/hot-source-1-group-tree/tabMs | 10 | 485.45 | 493.09 | 476.10 | 494.40 |
| production/C/hot-source-1-group-tab/selectionMs | 10 | 299.00 | 312.72 | 291.10 | 314.70 |
| production/C/hot-source-1-group-tab/tabMs | 10 | 299.00 | 312.72 | 291.10 | 314.70 |
| production/C/cold-source-2-group-tree/selectionMs | 10 | 2.95 | 3.53 | 2.70 | 3.80 |
| production/C/cold-source-2-group-tree/tabMs | 10 | 656.10 | 687.60 | 645.40 | 697.00 |
| production/C/hot-source-2-group-tree/selectionMs | 10 | 3.05 | 4.10 | 2.70 | 4.50 |
| production/C/hot-source-2-group-tree/tabMs | 10 | 491.05 | 502.38 | 480.80 | 505.80 |
| production/C/hot-source-2-group-tab/selectionMs | 10 | 303.65 | 311.98 | 299.80 | 312.20 |
| production/C/hot-source-2-group-tab/tabMs | 10 | 303.65 | 311.98 | 299.80 | 312.20 |

### 互斥关键路径区间

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/C/cold-rich-1-group-tree/clickToActivation | 10 | 180.45 | 182.24 | 180.30 | 183.00 |
| production/C/cold-rich-1-group-tree/activationToReadEnd | 10 | 13.05 | 32.19 | 10.70 | 39.80 |
| production/C/cold-rich-1-group-tree/readEndToSession | 10 | 201.60 | 247.80 | 177.20 | 250.90 |
| production/C/cold-rich-1-group-tree/sessionToView | 10 | 444.15 | 738.90 | 425.10 | 901.80 |
| production/C/cold-rich-1-group-tree/viewToEditable | 10 | 38.95 | 71.35 | 31.80 | 92.10 |
| production/C/hot-rich-1-group-tree/clickToActivation | 10 | 180.30 | 180.36 | 180.20 | 180.40 |
| production/C/hot-rich-1-group-tree/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tree/readEndToSession | 10 | 0.10 | 0.16 | 0.00 | 0.20 |
| production/C/hot-rich-1-group-tree/sessionToView | 10 | 162.15 | 188.57 | 151.70 | 202.70 |
| production/C/hot-rich-1-group-tree/viewToEditable | 10 | 191.35 | 207.91 | 174.40 | 208.00 |
| production/C/hot-rich-1-group-tab/clickToActivation | 10 | 0.15 | 0.20 | 0.10 | 0.20 |
| production/C/hot-rich-1-group-tab/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-1-group-tab/readEndToSession | 10 | 0.05 | 0.10 | 0.00 | 0.10 |
| production/C/hot-rich-1-group-tab/sessionToView | 10 | 155.70 | 163.85 | 145.80 | 163.90 |
| production/C/hot-rich-1-group-tab/viewToEditable | 10 | 191.45 | 202.18 | 180.30 | 203.80 |
| production/C/cold-rich-2-group-tree/clickToActivation | 10 | 180.30 | 180.35 | 180.20 | 180.40 |
| production/C/cold-rich-2-group-tree/activationToReadEnd | 10 | 12.20 | 17.75 | 10.60 | 20.50 |
| production/C/cold-rich-2-group-tree/readEndToSession | 10 | 153.55 | 170.12 | 144.50 | 177.50 |
| production/C/cold-rich-2-group-tree/sessionToView | 10 | 345.90 | 372.73 | 329.70 | 380.70 |
| production/C/cold-rich-2-group-tree/viewToEditable | 10 | 26.00 | 26.67 | 23.70 | 26.90 |
| production/C/hot-rich-2-group-tree/clickToActivation | 10 | 180.40 | 180.72 | 180.30 | 180.90 |
| production/C/hot-rich-2-group-tree/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tree/readEndToSession | 10 | 0.20 | 0.30 | 0.00 | 0.30 |
| production/C/hot-rich-2-group-tree/sessionToView | 10 | 150.85 | 156.79 | 148.00 | 158.10 |
| production/C/hot-rich-2-group-tree/viewToEditable | 10 | 181.20 | 189.62 | 174.40 | 192.10 |
| production/C/hot-rich-2-group-tab/clickToActivation | 10 | 0.15 | 0.20 | 0.10 | 0.20 |
| production/C/hot-rich-2-group-tab/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-rich-2-group-tab/readEndToSession | 10 | 0.15 | 0.26 | 0.10 | 0.30 |
| production/C/hot-rich-2-group-tab/sessionToView | 10 | 169.75 | 221.03 | 142.00 | 233.90 |
| production/C/hot-rich-2-group-tab/viewToEditable | 10 | 205.20 | 221.82 | 170.60 | 227.80 |
| production/C/cold-source-1-group-tree/clickToActivation | 10 | 181.10 | 182.42 | 180.30 | 182.60 |
| production/C/cold-source-1-group-tree/activationToReadEnd | 10 | 14.15 | 16.58 | 10.30 | 16.80 |
| production/C/cold-source-1-group-tree/readEndToSession | 10 | 144.10 | 148.46 | 133.30 | 149.40 |
| production/C/cold-source-1-group-tree/sessionToView | 10 | 306.45 | 414.23 | 288.80 | 491.40 |
| production/C/cold-source-1-group-tree/viewToEditable | 10 | 49.85 | 64.99 | 36.70 | 72.10 |
| production/C/hot-source-1-group-tree/clickToActivation | 10 | 180.45 | 182.86 | 180.20 | 183.80 |
| production/C/hot-source-1-group-tree/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tree/readEndToSession | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-source-1-group-tree/sessionToView | 10 | 142.00 | 149.17 | 135.90 | 149.30 |
| production/C/hot-source-1-group-tree/viewToEditable | 10 | 191.20 | 201.11 | 178.60 | 201.70 |
| production/C/hot-source-1-group-tab/clickToActivation | 10 | 0.20 | 0.26 | 0.00 | 0.30 |
| production/C/hot-source-1-group-tab/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tab/readEndToSession | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-source-1-group-tab/sessionToView | 10 | 136.70 | 139.46 | 132.90 | 139.60 |
| production/C/hot-source-1-group-tab/viewToEditable | 10 | 192.35 | 203.73 | 182.50 | 206.30 |
| production/C/cold-source-2-group-tree/clickToActivation | 10 | 181.35 | 185.57 | 180.30 | 186.20 |
| production/C/cold-source-2-group-tree/activationToReadEnd | 10 | 11.80 | 21.40 | 8.70 | 25.90 |
| production/C/cold-source-2-group-tree/readEndToSession | 10 | 147.30 | 156.17 | 139.80 | 156.30 |
| production/C/cold-source-2-group-tree/sessionToView | 10 | 302.55 | 330.33 | 296.90 | 341.80 |
| production/C/cold-source-2-group-tree/viewToEditable | 10 | 46.50 | 54.04 | 40.10 | 55.80 |
| production/C/hot-source-2-group-tree/clickToActivation | 10 | 180.60 | 185.41 | 180.30 | 186.40 |
| production/C/hot-source-2-group-tree/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tree/readEndToSession | 10 | 0.25 | 0.36 | 0.10 | 0.40 |
| production/C/hot-source-2-group-tree/sessionToView | 10 | 143.55 | 153.97 | 136.90 | 160.00 |
| production/C/hot-source-2-group-tree/viewToEditable | 10 | 192.50 | 198.79 | 189.00 | 201.90 |
| production/C/hot-source-2-group-tab/clickToActivation | 10 | 0.15 | 0.20 | 0.00 | 0.20 |
| production/C/hot-source-2-group-tab/activationToReadEnd | 10 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-2-group-tab/readEndToSession | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-source-2-group-tab/sessionToView | 10 | 139.15 | 143.68 | 133.70 | 144.40 |
| production/C/hot-source-2-group-tab/viewToEditable | 10 | 192.50 | 197.37 | 180.30 | 198.00 |

这些区间按时间线单调切分，相加等于该操作总耗时。无 read 的 hot 样本不虚构网络阶段。控件与解析 measure 是嵌套子阶段，不能再次相加。

files.activation.read 虽然只包 read await，仍包含主线程排队、响应解码与 Promise continuation；与 Resource Timing 读请求时长不同。TipTap initialize 是解析/模型/控件与 onCreate 调度联合区间；Monaco mount 包括模块等待、nextTick/layout。它们不能解释成纯解析或纯创建。

## D. 约 0.3 秒延迟

生产已出现 250–400 ms 操作，共 37 个；对应原始 C 样本 ID 保存在 reproduction.sampleIds，未复制样本充当新测量。

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| 生产 250–400 ms 样本 | 37 | 333.20 | 375.22 | 312.80 | 394.60 |

代表样本：production-C-hot-rich-1-group-tab-0。

| 区间 | 耗时 ms |
|---|---:|
| 点击至 activation（含单击等待） | 0.10 |
| activation 至 read 响应末尾 | 0.00 |
| 响应末尾至 session 发布 | 0.00 |
| session 至 view 发布 | 156.10 |
| view 发布至可编辑并跨帧确认 | 191.90 |

开发模式对照：生产已复现，本轮未要求开发对照。

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| 开发 250–400 ms 样本 | 0 | 未取得 | 未取得 | 未取得 | 未取得 |

开发代表样本：未取得。

| 区间 | 耗时 ms |
|---|---:|

本轮全部生产 C 的范围为 312.80–1465.90 ms；开发 C 为 未取得–未取得 ms。未命中 250–400 ms 时，D 的 count=0、分位数为空，保留该结果，不用 B 的展开时长或小规模试跑代替正式切换。

## 与 t16、t24 的可比性

t16/t24 在 Windows、Chromium 151.0.7922.34、Source Dev、1440×1000 下测两个 8 KiB permanent 标签，3×30 次；t24 富文本单组 p50/p95=33.5/38.0 ms，源码单组=43.5/53.8 ms。本轮是 Linux、headless Chrome、生产构建、约 3000 个 5–30 KiB 文件，每格 30 次，输入证明逐样本进行。视口和 capture-click 起点相同，但构建、平台、文件大小、工程规模与跨帧终点不同，不能直接计算回归幅度。

仅 hot-tab 的入口与历史标签切换对应；hot-tree 保留既有 180 ms 单击等待，不与 t24 标签值直接比较。双组 hot-tab 也保留为补充，本轮要求的单组富文本／源码两格均有独立样本。

## 网络与阶段分解

### 每次操作请求总数（单位：次）

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold | 5 | 38.00 | 50.40 | 38.00 | 52.00 |
| production/A/reopen | 5 | 39.00 | 43.00 | 39.00 | 44.00 |
| production/B/notes-wide | 10 | 2.00 | 6.55 | 2.00 | 7.00 |
| production/C/cold-rich-1-group-tree | 10 | 2.00 | 6.55 | 2.00 | 7.00 |
| production/C/hot-rich-1-group-tree | 10 | 1.00 | 1.55 | 1.00 | 2.00 |
| production/C/hot-rich-1-group-tab | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| production/C/cold-rich-2-group-tree | 10 | 3.00 | 4.10 | 2.00 | 5.00 |
| production/C/hot-rich-2-group-tree | 10 | 1.00 | 4.00 | 1.00 | 4.00 |
| production/C/hot-rich-2-group-tab | 10 | 1.00 | 1.55 | 1.00 | 2.00 |
| production/C/cold-source-1-group-tree | 10 | 3.50 | 7.10 | 2.00 | 8.00 |
| production/C/hot-source-1-group-tree | 10 | 1.00 | 2.55 | 1.00 | 3.00 |
| production/C/hot-source-1-group-tab | 10 | 2.00 | 2.00 | 1.00 | 2.00 |
| production/C/cold-source-2-group-tree | 10 | 3.00 | 5.55 | 2.00 | 6.00 |
| production/C/hot-source-2-group-tree | 10 | 1.00 | 2.00 | 1.00 | 2.00 |
| production/C/hot-source-2-group-tab | 10 | 1.00 | 2.00 | 1.00 | 2.00 |

### 每个请求耗时

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 5 | 7.80 | 9.10 | 7.10 | 9.30 |
| production/A/service-cold//api/config/bootstrap | 15 | 15.70 | 28.10 | 6.70 | 29.50 |
| production/A/service-cold//api/projects/open | 5 | 228.70 | 294.74 | 222.60 | 309.10 |
| production/A/service-cold//api/storage/user/context | 21 | 26.80 | 53.20 | 12.60 | 55.00 |
| production/A/service-cold//favicon.ico | 5 | 25.10 | 39.26 | 15.80 | 42.50 |
| production/A/service-cold//api/projects | 5 | 16.70 | 29.00 | 7.60 | 30.00 |
| production/A/service-cold//api/workspace-files/tree | 5 | 1694.80 | 2255.34 | 1558.40 | 2364.70 |
| production/A/service-cold//api/storage/user/action | 73 | 35.30 | 65.10 | 10.50 | 239.80 |
| production/A/service-cold//api/storage/project/context | 10 | 64.65 | 79.23 | 46.80 | 80.90 |
| production/A/service-cold//api/storage/project/action | 66 | 26.75 | 52.45 | 11.90 | 72.30 |
| production/A/reopen//api/auth/me | 5 | 12.00 | 17.00 | 7.90 | 17.40 |
| production/A/reopen//api/config/bootstrap | 15 | 16.60 | 25.05 | 6.80 | 31.00 |
| production/A/reopen//api/projects/open | 5 | 211.90 | 253.34 | 210.30 | 259.70 |
| production/A/reopen//api/storage/user/context | 20 | 24.55 | 34.39 | 19.20 | 36.10 |
| production/A/reopen//favicon.ico | 5 | 16.50 | 26.68 | 14.50 | 27.20 |
| production/A/reopen//api/storage/user/action | 72 | 29.00 | 143.70 | 11.80 | 161.60 |
| production/A/reopen//api/projects | 5 | 10.40 | 22.88 | 8.30 | 24.00 |
| production/A/reopen//api/workspace-files/tree | 5 | 1238.60 | 1944.32 | 1178.80 | 2117.50 |
| production/A/reopen//api/storage/project/context | 10 | 42.35 | 46.10 | 39.00 | 46.50 |
| production/A/reopen//api/storage/project/action | 58 | 27.80 | 47.32 | 9.60 | 112.80 |
| production/B/notes-wide//api/storage/user/action | 24 | 18.65 | 55.50 | 9.50 | 66.20 |
| production/B/notes-wide//api/storage/project/action | 8 | 28.65 | 90.71 | 9.40 | 91.90 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 10 | 12.75 | 31.14 | 10.30 | 38.30 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 4 | 29.20 | 41.34 | 13.70 | 42.20 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 40.90 | 40.90 | 40.90 | 40.90 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 38.20 | 38.20 | 38.20 | 38.20 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 15 | 25.60 | 45.60 | 19.10 | 47.70 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 11 | 16.50 | 20.85 | 10.60 | 22.00 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 10 | 16.35 | 18.79 | 13.30 | 19.20 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 10 | 11.70 | 17.45 | 10.30 | 20.20 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 19 | 13.50 | 24.42 | 9.90 | 37.20 |
| production/C/cold-rich-2-group-tree//api/storage/user/action | 2 | 13.75 | 14.15 | 13.30 | 14.20 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 14 | 14.95 | 21.02 | 11.40 | 21.60 |
| production/C/hot-rich-2-group-tree//api/storage/user/action | 3 | 15.60 | 21.72 | 15.00 | 22.40 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 10 | 16.65 | 21.00 | 12.20 | 21.90 |
| production/C/hot-rich-2-group-tab//api/storage/user/action | 1 | 16.60 | 16.60 | 16.60 | 16.60 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 10 | 13.55 | 15.88 | 9.60 | 16.20 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 40.80 | 40.80 | 40.80 | 40.80 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 23 | 13.00 | 20.16 | 7.80 | 20.40 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 5.60 | 5.60 | 5.60 | 5.60 |
| production/C/cold-source-1-group-tree//api/storage/user/action | 2 | 23.10 | 23.37 | 22.80 | 23.40 |
| production/C/cold-source-1-group-tree//_nuxt/editor.worker-CdQrwHl8.js | 2 | -4.80 | -3.45 | -6.30 | -3.30 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 15 | 14.10 | 16.50 | 8.60 | 17.90 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 18 | 12.10 | 15.10 | 8.60 | 15.70 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 18 | 12.70 | 27.09 | 7.70 | 30.40 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 10 | 11.25 | 20.80 | 8.20 | 25.30 |
| production/C/cold-source-2-group-tree//api/storage/user/action | 4 | 21.85 | 30.76 | 12.40 | 30.80 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 12 | 13.95 | 17.15 | 10.10 | 17.70 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 12 | 13.75 | 16.32 | 9.20 | 17.20 |

### 每个请求响应体大小（单位：bytes，encodedBodySize）

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 5 | 113.00 | 113.00 | 113.00 | 113.00 |
| production/A/service-cold//api/config/bootstrap | 15 | 302.00 | 302.00 | 301.00 | 302.00 |
| production/A/service-cold//api/projects/open | 5 | 275.00 | 275.00 | 275.00 | 275.00 |
| production/A/service-cold//api/storage/user/context | 21 | 17.00 | 80.00 | 17.00 | 80.00 |
| production/A/service-cold//favicon.ico | 5 | 78.00 | 78.00 | 78.00 | 78.00 |
| production/A/service-cold//api/projects | 5 | 210.00 | 210.00 | 210.00 | 210.00 |
| production/A/service-cold//api/workspace-files/tree | 5 | 1504692.00 | 1504692.00 | 1504692.00 | 1504692.00 |
| production/A/service-cold//api/storage/user/action | 73 | 98.00 | 104.00 | 0.00 | 924.00 |
| production/A/service-cold//api/storage/project/context | 10 | 80.00 | 80.00 | 80.00 | 80.00 |
| production/A/service-cold//api/storage/project/action | 66 | 98.00 | 104.00 | 48.00 | 104.00 |
| production/A/reopen//api/auth/me | 5 | 113.00 | 113.00 | 113.00 | 113.00 |
| production/A/reopen//api/config/bootstrap | 15 | 302.00 | 302.00 | 301.00 | 302.00 |
| production/A/reopen//api/projects/open | 5 | 275.00 | 275.00 | 275.00 | 275.00 |
| production/A/reopen//api/storage/user/context | 20 | 48.50 | 80.00 | 17.00 | 80.00 |
| production/A/reopen//favicon.ico | 5 | 78.00 | 78.00 | 78.00 | 78.00 |
| production/A/reopen//api/storage/user/action | 72 | 98.00 | 98.00 | 48.00 | 98.00 |
| production/A/reopen//api/projects | 5 | 210.00 | 210.00 | 210.00 | 210.00 |
| production/A/reopen//api/workspace-files/tree | 5 | 1504692.00 | 1504692.00 | 1504692.00 | 1504692.00 |
| production/A/reopen//api/storage/project/context | 10 | 80.00 | 80.00 | 80.00 | 80.00 |
| production/A/reopen//api/storage/project/action | 58 | 98.00 | 343.00 | 48.00 | 343.00 |
| production/B/notes-wide//api/storage/user/action | 24 | 104.00 | 191.00 | 98.00 | 191.00 |
| production/B/notes-wide//api/storage/project/action | 8 | 98.00 | 343.00 | 98.00 | 343.00 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 10 | 22532.50 | 30088.70 | 6188.00 | 30428.00 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 4 | 144.50 | 191.00 | 98.00 | 191.00 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 9845.00 | 9845.00 | 9845.00 | 9845.00 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 184.00 | 184.00 | 184.00 | 184.00 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 15 | 104.00 | 446.00 | 98.00 | 446.00 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 11 | 104.00 | 316.50 | 104.00 | 529.00 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 10 | 104.00 | 104.00 | 104.00 | 104.00 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 10 | 16953.50 | 27174.50 | 5567.00 | 29132.00 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 19 | 104.00 | 1007.00 | 104.00 | 1007.00 |
| production/C/cold-rich-2-group-tree//api/storage/user/action | 2 | 98.00 | 98.00 | 98.00 | 98.00 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 14 | 104.00 | 449.10 | 98.00 | 1090.00 |
| production/C/hot-rich-2-group-tree//api/storage/user/action | 3 | 98.00 | 98.00 | 98.00 | 98.00 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 10 | 104.00 | 104.00 | 104.00 | 104.00 |
| production/C/hot-rich-2-group-tab//api/storage/user/action | 1 | 98.00 | 98.00 | 98.00 | 98.00 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 10 | 22534.00 | 30089.70 | 6189.00 | 30429.00 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 2210.00 | 2210.00 | 2210.00 | 2210.00 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 23 | 104.00 | 446.00 | 98.00 | 446.00 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 3650.00 | 3650.00 | 3650.00 | 3650.00 |
| production/C/cold-source-1-group-tree//api/storage/user/action | 2 | 144.50 | 186.35 | 98.00 | 191.00 |
| production/C/cold-source-1-group-tree//_nuxt/editor.worker-CdQrwHl8.js | 2 | 251810.00 | 251810.00 | 251810.00 | 251810.00 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 15 | 104.00 | 529.00 | 98.00 | 529.00 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 18 | 104.00 | 529.00 | 104.00 | 529.00 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 18 | 104.00 | 1007.00 | 98.00 | 1007.00 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 10 | 16955.50 | 27176.95 | 5569.00 | 29134.00 |
| production/C/cold-source-2-group-tree//api/storage/user/action | 4 | 98.00 | 177.05 | 98.00 | 191.00 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 12 | 104.00 | 547.70 | 98.00 | 1090.00 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 12 | 104.00 | 1090.00 | 104.00 | 1090.00 |

### 首字节等待（服务执行与排队均在此内）

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 5 | 6.30 | 7.08 | 5.50 | 7.20 |
| production/A/service-cold//api/config/bootstrap | 15 | 12.20 | 26.35 | 5.10 | 27.40 |
| production/A/service-cold//api/projects/open | 5 | 227.30 | 293.02 | 221.30 | 307.30 |
| production/A/service-cold//api/storage/user/context | 21 | 25.00 | 48.90 | 9.70 | 50.50 |
| production/A/service-cold//favicon.ico | 5 | 23.60 | 35.62 | 14.40 | 38.40 |
| production/A/service-cold//api/projects | 5 | 15.10 | 26.14 | 6.20 | 27.20 |
| production/A/service-cold//api/workspace-files/tree | 5 | 1691.40 | 2250.86 | 1553.60 | 2360.10 |
| production/A/service-cold//api/storage/user/action | 73 | 28.00 | 59.70 | 0.00 | 237.90 |
| production/A/service-cold//api/storage/project/context | 10 | 41.45 | 44.86 | 32.30 | 45.40 |
| production/A/service-cold//api/storage/project/action | 66 | 24.70 | 45.30 | 10.30 | 57.10 |
| production/A/reopen//api/auth/me | 5 | 9.80 | 15.58 | 6.40 | 16.00 |
| production/A/reopen//api/config/bootstrap | 15 | 14.80 | 21.10 | 5.30 | 23.20 |
| production/A/reopen//api/projects/open | 5 | 210.70 | 251.12 | 209.10 | 257.40 |
| production/A/reopen//api/storage/user/context | 20 | 23.15 | 32.29 | 17.50 | 34.00 |
| production/A/reopen//favicon.ico | 5 | 14.90 | 23.66 | 13.10 | 24.50 |
| production/A/reopen//api/storage/user/action | 72 | 26.85 | 140.05 | 9.80 | 158.50 |
| production/A/reopen//api/projects | 5 | 8.00 | 20.06 | 7.00 | 21.20 |
| production/A/reopen//api/workspace-files/tree | 5 | 1235.10 | 1936.32 | 1175.60 | 2108.40 |
| production/A/reopen//api/storage/project/context | 10 | 40.40 | 44.32 | 36.20 | 44.50 |
| production/A/reopen//api/storage/project/action | 58 | 26.15 | 44.84 | 8.20 | 72.90 |
| production/B/notes-wide//api/storage/user/action | 24 | 16.80 | 51.92 | 8.10 | 63.20 |
| production/B/notes-wide//api/storage/project/action | 8 | 26.00 | 79.59 | 8.10 | 79.70 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 10 | 11.15 | 25.47 | 8.30 | 30.60 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 4 | 27.25 | 39.12 | 12.00 | 39.90 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 32.50 | 32.50 | 32.50 | 32.50 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 32.70 | 32.70 | 32.70 | 32.70 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 15 | 23.90 | 41.36 | 17.40 | 42.90 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 11 | 15.00 | 19.55 | 9.40 | 20.70 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 10 | 14.90 | 17.55 | 11.80 | 18.00 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 10 | 9.95 | 15.70 | 8.60 | 18.40 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 19 | 12.20 | 22.92 | 8.20 | 35.70 |
| production/C/cold-rich-2-group-tree//api/storage/user/action | 2 | 11.75 | 12.69 | 10.70 | 12.80 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 14 | 13.70 | 18.54 | 9.90 | 18.80 |
| production/C/hot-rich-2-group-tree//api/storage/user/action | 3 | 13.50 | 18.54 | 13.30 | 19.10 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 10 | 15.10 | 19.36 | 10.50 | 20.30 |
| production/C/hot-rich-2-group-tab//api/storage/user/action | 1 | 14.70 | 14.70 | 14.70 | 14.70 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 10 | 11.45 | 13.78 | 7.70 | 14.10 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 39.30 | 39.30 | 39.30 | 39.30 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 23 | 11.80 | 18.39 | 6.60 | 18.40 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 4.20 | 4.20 | 4.20 | 4.20 |
| production/C/cold-source-1-group-tree//api/storage/user/action | 2 | 20.20 | 20.20 | 20.20 | 20.20 |
| production/C/cold-source-1-group-tree//_nuxt/editor.worker-CdQrwHl8.js | 2 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 15 | 12.60 | 14.86 | 7.20 | 16.40 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 18 | 10.90 | 13.80 | 7.20 | 14.40 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 18 | 11.35 | 25.02 | 6.50 | 29.10 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 10 | 9.40 | 18.74 | 6.80 | 23.20 |
| production/C/cold-source-2-group-tree//api/storage/user/action | 4 | 20.10 | 28.37 | 10.30 | 28.40 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 12 | 12.55 | 15.51 | 8.80 | 16.00 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 12 | 12.25 | 14.72 | 7.80 | 15.60 |

### 响应体传输

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold//api/auth/me | 5 | 1.00 | 1.28 | 0.70 | 1.30 |
| production/A/service-cold//api/config/bootstrap | 15 | 1.20 | 1.53 | 1.00 | 1.60 |
| production/A/service-cold//api/projects/open | 5 | 1.00 | 1.28 | 0.80 | 1.30 |
| production/A/service-cold//api/storage/user/context | 21 | 1.20 | 2.10 | 0.90 | 3.70 |
| production/A/service-cold//favicon.ico | 5 | 1.20 | 1.86 | 1.00 | 2.00 |
| production/A/service-cold//api/projects | 5 | 1.10 | 2.50 | 0.80 | 2.60 |
| production/A/service-cold//api/workspace-files/tree | 5 | 2.90 | 3.92 | 2.80 | 4.00 |
| production/A/service-cold//api/storage/user/action | 73 | 1.40 | 3.18 | 0.80 | 1473.30 |
| production/A/service-cold//api/storage/project/context | 10 | 1.15 | 1.92 | 0.80 | 2.10 |
| production/A/service-cold//api/storage/project/action | 66 | 1.25 | 2.80 | 0.70 | 6.10 |
| production/A/reopen//api/auth/me | 5 | 0.90 | 1.24 | 0.80 | 1.30 |
| production/A/reopen//api/config/bootstrap | 15 | 1.30 | 3.50 | 0.90 | 6.30 |
| production/A/reopen//api/projects/open | 5 | 0.80 | 1.20 | 0.80 | 1.20 |
| production/A/reopen//api/storage/user/context | 20 | 1.20 | 2.20 | 0.90 | 2.20 |
| production/A/reopen//favicon.ico | 5 | 1.00 | 2.44 | 0.90 | 2.60 |
| production/A/reopen//api/storage/user/action | 72 | 1.70 | 3.59 | 0.80 | 4.70 |
| production/A/reopen//api/projects | 5 | 1.20 | 2.18 | 0.80 | 2.20 |
| production/A/reopen//api/workspace-files/tree | 5 | 2.80 | 7.24 | 2.70 | 8.30 |
| production/A/reopen//api/storage/project/context | 10 | 1.50 | 2.20 | 1.00 | 2.20 |
| production/A/reopen//api/storage/project/action | 58 | 1.00 | 2.46 | 0.70 | 3.90 |
| production/B/notes-wide//api/storage/user/action | 24 | 1.00 | 2.30 | 0.70 | 3.00 |
| production/B/notes-wide//api/storage/project/action | 8 | 1.55 | 10.15 | 0.80 | 11.20 |
| production/C/cold-rich-1-group-tree//api/workspace-files/read | 10 | 1.20 | 2.62 | 0.80 | 2.80 |
| production/C/cold-rich-1-group-tree//api/storage/user/action | 4 | 1.25 | 1.65 | 1.10 | 1.70 |
| production/C/cold-rich-1-group-tree//_nuxt/Cf5dZK5S.js | 1 | 7.30 | 7.30 | 7.30 | 7.30 |
| production/C/cold-rich-1-group-tree//_nuxt/MarkdownEditorView.Bfq3d12B.css | 1 | 3.50 | 3.50 | 3.50 | 3.50 |
| production/C/cold-rich-1-group-tree//api/storage/project/action | 15 | 1.20 | 2.94 | 0.90 | 3.50 |
| production/C/hot-rich-1-group-tree//api/storage/project/action | 11 | 0.90 | 1.10 | 0.80 | 1.20 |
| production/C/hot-rich-1-group-tab//api/storage/project/action | 10 | 0.80 | 1.06 | 0.80 | 1.10 |
| production/C/cold-rich-2-group-tree//api/workspace-files/read | 10 | 1.10 | 1.26 | 0.90 | 1.30 |
| production/C/cold-rich-2-group-tree//api/storage/project/action | 19 | 0.90 | 1.23 | 0.70 | 1.50 |
| production/C/cold-rich-2-group-tree//api/storage/user/action | 2 | 1.30 | 1.66 | 0.90 | 1.70 |
| production/C/hot-rich-2-group-tree//api/storage/project/action | 14 | 0.80 | 1.41 | 0.70 | 1.80 |
| production/C/hot-rich-2-group-tree//api/storage/user/action | 3 | 1.70 | 2.42 | 0.90 | 2.50 |
| production/C/hot-rich-2-group-tab//api/storage/project/action | 10 | 1.00 | 1.17 | 0.70 | 1.30 |
| production/C/hot-rich-2-group-tab//api/storage/user/action | 1 | 0.80 | 0.80 | 0.80 | 0.80 |
| production/C/cold-source-1-group-tree//api/workspace-files/read | 10 | 1.00 | 1.15 | 0.80 | 1.20 |
| production/C/cold-source-1-group-tree//_nuxt/C8PYsxcl.js | 1 | 0.80 | 0.80 | 0.80 | 0.80 |
| production/C/cold-source-1-group-tree//api/storage/project/action | 23 | 0.80 | 1.10 | 0.60 | 1.40 |
| production/C/cold-source-1-group-tree//_nuxt/BFxVWTOG.js | 1 | 0.90 | 0.90 | 0.90 | 0.90 |
| production/C/cold-source-1-group-tree//api/storage/user/action | 2 | 2.30 | 2.66 | 1.90 | 2.70 |
| production/C/cold-source-1-group-tree//_nuxt/editor.worker-CdQrwHl8.js | 2 | 0.00 | 0.00 | 0.00 | 0.00 |
| production/C/hot-source-1-group-tree//api/storage/project/action | 15 | 1.00 | 1.06 | 0.70 | 1.20 |
| production/C/hot-source-1-group-tab//api/storage/project/action | 18 | 0.90 | 1.03 | 0.70 | 1.20 |
| production/C/cold-source-2-group-tree//api/storage/project/action | 18 | 0.90 | 1.23 | 0.70 | 1.40 |
| production/C/cold-source-2-group-tree//api/workspace-files/read | 10 | 0.95 | 1.31 | 0.70 | 1.40 |
| production/C/cold-source-2-group-tree//api/storage/user/action | 4 | 1.60 | 1.95 | 0.70 | 2.00 |
| production/C/hot-source-2-group-tree//api/storage/project/action | 12 | 0.95 | 1.20 | 0.80 | 1.20 |
| production/C/hot-source-2-group-tab//api/storage/project/action | 12 | 0.90 | 1.15 | 0.70 | 1.20 |

### Server-Timing

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold/auth.user | 5 | 1.20 | 1.38 | 0.90 | 1.40 |
| production/A/service-cold/config.bootstrap | 15 | 1.00 | 2.58 | 0.60 | 3.00 |
| production/A/service-cold/files.project.ref | 5 | 0.80 | 1.20 | 0.70 | 1.30 |
| production/A/service-cold/files.project.open | 5 | 206.90 | 257.90 | 191.50 | 270.10 |
| production/A/service-cold/projects.manifests | 5 | 0.20 | 0.20 | 0.10 | 0.20 |
| production/A/service-cold/projects.total | 5 | 0.20 | 0.20 | 0.10 | 0.20 |
| production/A/service-cold/files.tree.resolve | 5 | 5.70 | 8.14 | 4.80 | 8.60 |
| production/A/service-cold/files.tree.index | 5 | 1657.50 | 2210.48 | 1517.30 | 2318.70 |
| production/A/reopen/auth.user | 5 | 1.30 | 6.46 | 0.90 | 7.60 |
| production/A/reopen/config.bootstrap | 15 | 1.00 | 2.70 | 0.50 | 3.40 |
| production/A/reopen/files.project.ref | 5 | 0.20 | 0.28 | 0.10 | 0.30 |
| production/A/reopen/files.project.open | 5 | 193.10 | 227.62 | 189.70 | 235.30 |
| production/A/reopen/projects.manifests | 5 | 0.20 | 0.20 | 0.10 | 0.20 |
| production/A/reopen/projects.total | 5 | 0.20 | 0.20 | 0.10 | 0.20 |
| production/A/reopen/files.tree.resolve | 5 | 3.30 | 5.26 | 2.50 | 5.70 |
| production/A/reopen/files.tree.index | 5 | 1211.20 | 1900.36 | 1147.40 | 2070.60 |
| production/C/cold-rich-1-group-tree/files.read.resolve | 10 | 0.30 | 0.45 | 0.30 | 0.50 |
| production/C/cold-rich-1-group-tree/files.read.read | 10 | 2.25 | 4.59 | 1.70 | 5.90 |
| production/C/cold-rich-2-group-tree/files.read.resolve | 10 | 0.30 | 0.50 | 0.30 | 0.50 |
| production/C/cold-rich-2-group-tree/files.read.read | 10 | 2.10 | 6.94 | 1.50 | 10.50 |
| production/C/cold-source-1-group-tree/files.read.resolve | 10 | 0.30 | 0.55 | 0.20 | 0.60 |
| production/C/cold-source-1-group-tree/files.read.read | 10 | 1.75 | 2.16 | 1.40 | 2.20 |
| production/C/cold-source-2-group-tree/files.read.resolve | 10 | 0.30 | 0.55 | 0.30 | 0.60 |
| production/C/cold-source-2-group-tree/files.read.read | 10 | 1.60 | 2.06 | 1.40 | 2.10 |

### User Timing

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold/files.tree.client | 5 | 1711.20 | 2277.08 | 1575.80 | 2387.40 |
| production/A/service-cold/files.tree.project | 5 | 28.90 | 36.72 | 25.10 | 36.90 |
| production/A/service-cold/files.tree.build | 5 | 3.30 | 3.54 | 3.10 | 3.60 |
| production/A/reopen/files.tree.client | 5 | 1267.50 | 1964.82 | 1195.60 | 2138.80 |
| production/A/reopen/files.tree.project | 5 | 27.80 | 31.16 | 23.80 | 31.20 |
| production/A/reopen/files.tree.build | 5 | 3.40 | 4.04 | 2.90 | 4.20 |
| production/C/cold-rich-1-group-tree/files.activation | 10 | 448.40 | 614.93 | 408.90 | 711.50 |
| production/C/cold-rich-1-group-tree/files.activation.read | 10 | 214.25 | 279.14 | 189.80 | 289.40 |
| production/C/cold-rich-1-group-tree/editor.session.publish | 10 | 0.20 | 0.61 | 0.10 | 0.70 |
| production/C/cold-rich-1-group-tree/editor.tiptap.create | 10 | 233.90 | 300.66 | 102.40 | 305.20 |
| production/C/cold-rich-1-group-tree/editor.tiptap.initialize | 10 | 224.00 | 289.74 | 55.20 | 293.70 |
| production/C/cold-rich-1-group-tree/editor.view.publish | 10 | 0.10 | 0.53 | 0.00 | 0.80 |
| production/C/hot-rich-1-group-tree/editor.session.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-rich-1-group-tree/files.activation | 10 | 174.20 | 202.09 | 163.10 | 216.80 |
| production/C/hot-rich-1-group-tree/editor.view.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-rich-1-group-tab/editor.session.publish | 10 | 0.05 | 0.10 | 0.00 | 0.10 |
| production/C/hot-rich-1-group-tab/files.activation | 10 | 168.10 | 176.23 | 158.40 | 177.40 |
| production/C/hot-rich-1-group-tab/editor.view.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/cold-rich-2-group-tree/files.activation.read | 10 | 166.60 | 180.49 | 156.10 | 188.00 |
| production/C/cold-rich-2-group-tree/files.activation | 10 | 342.85 | 376.48 | 322.90 | 379.00 |
| production/C/cold-rich-2-group-tree/editor.session.publish | 10 | 0.20 | 0.20 | 0.10 | 0.20 |
| production/C/cold-rich-2-group-tree/editor.tiptap.create | 10 | 184.05 | 200.71 | 171.60 | 201.20 |
| production/C/cold-rich-2-group-tree/editor.tiptap.initialize | 10 | 173.85 | 190.81 | 161.10 | 191.40 |
| production/C/cold-rich-2-group-tree/editor.view.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-rich-2-group-tree/files.activation | 10 | 167.70 | 172.97 | 163.30 | 174.50 |
| production/C/hot-rich-2-group-tree/editor.session.publish | 10 | 0.20 | 0.26 | 0.00 | 0.30 |
| production/C/hot-rich-2-group-tree/editor.view.publish | 10 | 0.00 | 0.10 | 0.00 | 0.10 |
| production/C/hot-rich-2-group-tab/editor.session.publish | 10 | 0.10 | 0.20 | 0.10 | 0.20 |
| production/C/hot-rich-2-group-tab/files.activation | 10 | 189.05 | 243.17 | 157.80 | 257.30 |
| production/C/hot-rich-2-group-tab/editor.view.publish | 10 | 0.10 | 0.16 | 0.00 | 0.20 |
| production/C/cold-source-1-group-tree/files.activation | 10 | 313.30 | 324.69 | 293.20 | 325.50 |
| production/C/cold-source-1-group-tree/files.activation.read | 10 | 156.65 | 163.97 | 148.90 | 165.90 |
| production/C/cold-source-1-group-tree/editor.session.publish | 10 | 0.20 | 0.20 | 0.00 | 0.20 |
| production/C/cold-source-1-group-tree/editor.monaco.mount | 10 | 153.60 | 169.17 | 145.70 | 173.40 |
| production/C/cold-source-1-group-tree/editor.monaco.model | 10 | 0.50 | 3.89 | 0.20 | 6.50 |
| production/C/cold-source-1-group-tree/editor.monaco.create | 10 | 5.25 | 86.03 | 3.60 | 151.10 |
| production/C/cold-source-1-group-tree/editor.view.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-source-1-group-tree/editor.session.publish | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-source-1-group-tree/files.activation | 10 | 159.05 | 165.29 | 152.90 | 165.60 |
| production/C/hot-source-1-group-tree/editor.view.publish | 10 | 0.10 | 0.16 | 0.00 | 0.20 |
| production/C/hot-source-1-group-tab/editor.session.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |
| production/C/hot-source-1-group-tab/files.activation | 10 | 151.30 | 154.68 | 147.30 | 155.80 |
| production/C/hot-source-1-group-tab/editor.view.publish | 10 | 0.00 | 0.16 | 0.00 | 0.20 |
| production/C/cold-source-2-group-tree/files.activation.read | 10 | 161.10 | 166.85 | 153.20 | 167.30 |
| production/C/cold-source-2-group-tree/files.activation | 10 | 315.10 | 342.91 | 306.30 | 351.60 |
| production/C/cold-source-2-group-tree/editor.session.publish | 10 | 0.20 | 0.26 | 0.10 | 0.30 |
| production/C/cold-source-2-group-tree/editor.monaco.mount | 10 | 154.70 | 162.18 | 149.00 | 162.90 |
| production/C/cold-source-2-group-tree/editor.monaco.model | 10 | 0.30 | 0.57 | 0.20 | 0.80 |
| production/C/cold-source-2-group-tree/editor.monaco.create | 10 | 5.05 | 9.09 | 4.40 | 11.70 |
| production/C/cold-source-2-group-tree/editor.view.publish | 10 | 0.00 | 0.10 | 0.00 | 0.10 |
| production/C/hot-source-2-group-tree/editor.session.publish | 10 | 0.20 | 0.30 | 0.10 | 0.30 |
| production/C/hot-source-2-group-tree/files.activation | 10 | 161.85 | 173.10 | 153.00 | 179.00 |
| production/C/hot-source-2-group-tree/editor.view.publish | 10 | 0.05 | 0.10 | 0.00 | 0.10 |
| production/C/hot-source-2-group-tab/editor.session.publish | 10 | 0.10 | 0.20 | 0.00 | 0.20 |
| production/C/hot-source-2-group-tab/files.activation | 10 | 154.80 | 159.63 | 152.50 | 160.80 |
| production/C/hot-source-2-group-tab/editor.view.publish | 10 | 0.10 | 0.10 | 0.00 | 0.10 |

### 各操作最长主线程任务

| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| production/A/service-cold | 5 | 773.00 | 1024.40 | 711.00 | 1077.00 |
| production/A/reopen | 5 | 718.00 | 969.00 | 699.00 | 1022.00 |
| production/B/notes-wide | 10 | 116.50 | 160.50 | 73.00 | 174.00 |
| production/C/cold-rich-1-group-tree | 10 | 433.50 | 653.75 | 416.00 | 755.00 |
| production/C/hot-rich-1-group-tree | 10 | 337.50 | 375.30 | 312.00 | 396.00 |
| production/C/hot-rich-1-group-tab | 10 | 339.00 | 351.75 | 322.00 | 354.00 |
| production/C/cold-rich-2-group-tree | 10 | 338.00 | 365.35 | 322.00 | 373.00 |
| production/C/hot-rich-2-group-tree | 10 | 321.50 | 331.20 | 315.00 | 333.00 |
| production/C/hot-rich-2-group-tab | 10 | 371.50 | 426.75 | 307.00 | 438.00 |
| production/C/cold-source-1-group-tree | 10 | 309.50 | 324.30 | 296.00 | 327.00 |
| production/C/hot-source-1-group-tree | 10 | 303.00 | 310.20 | 293.00 | 312.00 |
| production/C/hot-source-1-group-tab | 10 | 304.00 | 313.00 | 294.00 | 313.00 |
| production/C/cold-source-2-group-tree | 10 | 311.00 | 337.75 | 305.00 | 349.00 |
| production/C/hot-source-2-group-tree | 10 | 308.00 | 317.05 | 298.00 | 322.00 |
| production/C/hot-source-2-group-tab | 10 | 309.50 | 318.65 | 303.00 | 320.00 |

## 性能标准对照

采用 p95 与规范时限作对照；规范本身没有指定分位数，因此本表是报告约定，不是改写产品合同。

| 变体 | 规范时限 ms | 实测 p95 ms | 结果 |
|---|---:|---:|---|
| production/A/service-cold | 1000 | 3705.74 | p95 超出 |
| production/A/reopen | 300 | 3287.80 | p95 超出 |
| production/C/cold-rich-1-group-tree | 200 | 1243.73 | p95 超出 |
| production/C/hot-rich-1-group-tree | 100 | 571.36 | p95 超出 |
| production/C/hot-rich-1-group-tab | 100 | 364.42 | p95 超出 |
| production/C/cold-rich-2-group-tree | 200 | 749.56 | p95 超出 |
| production/C/hot-rich-2-group-tree | 100 | 522.82 | p95 超出 |
| production/C/hot-rich-2-group-tab | 100 | 433.52 | p95 超出 |
| production/C/cold-source-1-group-tree | 200 | 808.85 | p95 超出 |
| production/C/hot-source-1-group-tree | 100 | 528.40 | p95 超出 |
| production/C/hot-source-1-group-tab | 100 | 341.85 | p95 超出 |
| production/C/cold-source-2-group-tree | 200 | 724.17 | p95 超出 |
| production/C/hot-source-2-group-tree | 100 | 530.95 | p95 超出 |
| production/C/hot-source-2-group-tab | 100 | 335.07 | p95 超出 |

## 测量设计与环境

- 固定种子 42017，生成 1000 个 Markdown，5120–30720 bytes，合成文件共 17290238 bytes；root: 1 (0.10%)；lorebook: 299 (29.90%)；manuscript: 332 (33.20%)；notes: 368 (36.80%)。产品创建时的默认模板文件保留，fileCount/totalBytes 只统计生成器。普通主体目录深度 3–5 层；index.md 与宽目录是明确的浅层入口。
- 用真实 POST /api/projects 创建项目后写入返回 projectRoot 对应的隔离 State Root；项目卡片的真实 click 发起打开。rich 与 source 使用不同项目，避免旧标签与分组恢复污染。
- 起止判定：{"percentile":"线性插值，位置 (n-1)*p；仅成功且输入验证通过的样本进入统计","tree":"click 捕获事件至三个根目录已渲染、可命中，连续两个动画帧成立","directory":"直接子行全部渲染、展开动画结束，连续两个动画帧成立","editor":"当前活动组目标标签选中、正确标记出现在可见编辑器、输入可写且不 busy；连续两个动画帧成立；窗口外输入并撤销","cold":"A 每次重启服务；C 每次用该项目中从未打开的文件；不清 OS 页缓存","desktop":"桌面版未测"}。
- 样本统计保留 Resource Timing、Server-Timing、固定名字的 User Timing measure、Long Tasks、Long Animation Frames 原始条目；每个样本记录 loadAverage。常驻计时不生成 mark 或序号名字。
- 环境：{"hostname":"archlinux","platform":"linux","arch":"x64","bun":"1.4.2","cpuModel":"Intel(R) Core(TM) i5-1035G1 CPU @ 1.00GHz","cpuCount":8,"memoryBytes":16429027328,"chrome":"151.0.7922.71","loadAtStart":[2.92,2.35,2.16],"loadAtEnd":[3.41,3.12,2.6],"viewport":{"width":1440,"height":1000},"headless":true}。
- State Root：/tmp/neuro-book/t42-files-baseline-KzsHPD/state；样本、State Root 与独立 Chrome profile 已清理=true；仅超限 profiling 文件留存=[]。
- 构建日志：/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-1000-build.log；命令与逐次服务启动日志与报告同目录。

## 跟踪与 CPU 采样

| 运行 | 采样对象 | CPU 样本数 | 分类采样区间 ms | 原始文件 |
|---|---|---:|---|---|
| accept-1000-directory-expand | browser | 374 | {"未归类 CPU":213.12899999999993,"空闲或原生未归类":131.59799999999993,"垃圾回收":1.073} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-1000-directory-expand.cpuprofile (31029 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-1000-directory-expand.trace.json (652701 bytes) |
| accept-1000-production-rich-1-group | browser | 780 | {"未归类 CPU":154.38899993896473,"空闲或原生未归类":130.87699999999998,"Vue 深度遍历":424.0370000000002,"垃圾回收":3.2329999999999997,"富文本控件与视图":9.564} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-1000-production-rich-1-group.cpuprofile (142993 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-1000-production-rich-1-group.trace.json (356588 bytes) |
| accept-1000-production-rich-2-group | browser | 818 | {"未归类 CPU":178.4339999389648,"空闲或原生未归类":117.70199999999996,"Vue 深度遍历":448.07900000000046,"垃圾回收":5.374,"富文本控件与视图":7.0840000000000005,"Monaco 模型与控件":1.101,"富文本解析与模型":1.066,"Vue 更新":1.56} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-1000-production-rich-2-group.cpuprofile (193542 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-1000-production-rich-2-group.trace.json (359547 bytes) |
| accept-1000-production-source-1-group | browser | 749 | {"未归类 CPU":172.6939999999999,"空闲或原生未归类":112.84699999999997,"Vue 深度遍历":390.1790000000003,"Vue 更新":9.901,"垃圾回收":2.146,"Monaco 模型与控件":7.607,"富文本控件与视图":2.1260000000000003} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-1000-production-source-1-group.cpuprofile (159552 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-1000-production-source-1-group.trace.json (386045 bytes) |
| accept-1000-production-source-2-group | browser | 760 | {"未归类 CPU":205.78700000000018,"空闲或原生未归类":91.31499999999997,"Vue 深度遍历":388.19199999999995,"垃圾回收":3.274,"Monaco 模型与控件":11.785,"富文本控件与视图":1.065,"Vue 更新":8.982000000000001} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-1000-production-source-2-group.cpuprofile (177187 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-1000-production-source-2-group.trace.json (353861 bytes) |
| accept-1000-project-open | browser | 2892 | {"未归类 CPU":506.4749999389642,"空闲或原生未归类":1352.4150000000018,"Vue 深度遍历":577.8959999999992,"垃圾回收":55.61400000000001} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-1000-project-open.cpuprofile (424372 bytes)；/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-1000-project-open.trace.json (1384701 bytes) |
| accept-1000-server-project-open | server | 1105 | {"未归类 CPU":1562.1062499999996,"frontmatter 与 YAML":679.2399999999997,"目录与索引（含路径校验）":234.70199999999997,"垃圾回收":1.253,"索引问题校验":15.098999999999998} | /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/t42-accept/accept-1000-server-project-open.cpuprofile (869426 bytes) |

### 服务代表窗口构成

| 代表运行与类别 | 分类采样区间 ms | 占打开窗口 |
|---|---:|---:|
| accept-1000-server-project-open/未归类 CPU | 1562.11 | 62.67% |
| accept-1000-server-project-open/frontmatter 与 YAML | 679.24 | 27.25% |
| accept-1000-server-project-open/目录与索引（含路径校验） | 234.70 | 9.42% |
| accept-1000-server-project-open/垃圾回收 | 1.25 | 0.05% |
| accept-1000-server-project-open/索引问题校验 | 15.10 | 0.61% |

这些类别分配相邻采样时间戳区间，不是精确 CPU 活跃时间；原生、异步 I/O 与稀疏采样间隔仍可能归到当前栈，未归类不自动解释为 CPU 或磁盘。服务 timeDeltas 原值与 topFunctions 保留在 JSON/profile，复核时不能仅凭压缩名认定热点。

### 切换代表窗口的 Vue 深度遍历

| 代表运行 | 操作窗口 ms | traverse 分类采样区间 ms | 占窗口 |
|---|---:|---:|---:|
| accept-1000-production-rich-1-group | 722.10 | 424.04 | 58.72% |
| accept-1000-production-rich-2-group | 760.40 | 448.08 | 58.93% |
| accept-1000-production-source-1-group | 697.50 | 390.18 | 55.94% |
| accept-1000-production-source-2-group | 710.40 | 388.19 | 54.64% |

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
