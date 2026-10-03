import {stats, type ProfileEvidence, type Sample, type Stats} from "./files-baseline-observations";
import type {ProductionProvenance} from "./files-baseline-resume";

export const timingPoints = [
    {file: "server/api/projects/open.post.ts", name: "files.project.ref", boundary: "读取并校验打开请求"},
    {file: "server/api/projects/open.post.ts", name: "files.project.open", boundary: "Project Session 与 required 模块 minimum-ready；完整 File Index warm-up 在后台"},
    {file: "server/api/workspace-files/tree.get.ts", name: "files.tree.resolve / files.tree.index / files.tree.scan", boundary: "目标解析、Project snapshot 或 plain Workspace 扫描；原 workspace.resolve / workspace.index / workspace.tree 改名"},
    {file: "server/api/workspace-files/stat.get.ts", name: "files.stat.resolve / files.stat.read", boundary: "目标解析、文件 stat DTO"},
    {file: "server/api/workspace-files/read.get.ts", name: "files.read.resolve / files.read.read", boundary: "目标解析、文件正文与文件状态读取"},
    {file: "app/stores/novel-ide.ts", name: "files.tree.client", boundary: "发起 tree 请求至响应 JSON 解码完成；不含状态提交"},
    {file: "app/stores/novel-ide.ts", name: "files.activation / files.activation.stat / files.activation.read", boundary: "激活整体；stat fallback 请求；read 请求本身（read 子阶段不含 buffer/session 提交）"},
    {file: "app/stores/novel-ide.ts", name: "editor.session.publish", boundary: "openTabInGroup 与 session outcome 提交"},
    {file: "app/components/novel-ide/workspace/workspace-file-tree.ts", name: "files.tree.project / files.tree.build", boundary: "节点模式投影、扁平快照建树及排序"},
    {file: "app/components/editor-workbench/EditorViewHost.vue", name: "editor.view.publish", boundary: "原顺序 releaseActive、lastUsed 更新、handle/actions 发布及 retained view 收口；不含异步控件创建"},
    {file: "app/components/markdown-studio/TipTapMarkdownEditor.vue", name: "editor.tiptap.create / editor.tiptap.initialize", boundary: "useEditor 配置至 onCreate；onBeforeCreate 至 onCreate（解析、模型与控件的联合阶段）"},
    {file: "app/components/markdown-studio/load-monaco-editor.ts", name: "editor.monaco.load", boundary: "首次按需模块和 worker 加载至环境建立"},
    {file: "app/components/editor-workbench/MonacoCodeEditor.vue", name: "editor.monaco.model / editor.monaco.create / editor.monaco.mount", boundary: "createModel、editor.create、onMounted 至布局与 ready 前"},
] as const;

export type MeasurementReport = {
    schema: string;
    generatedAt: string;
    completed: boolean;
    sourceRevision: string;
    build: {requested: boolean; logPath: string; image: unknown};
    environment: Record<string, unknown>;
    sample: {
        seed: number; fileCount: number; minBytes: number; maxBytes: number; totalBytes: number;
        categoryCounts: Record<string, number>; wideDirectoryPath: string; wideDirectoryChildren: number;
        stateRoot: string; cleanedAfterRun: boolean; retainedProfiles: string[];
        options: {iterations: number; openIterations: number};
    };
    methodology: Record<string, string>;
    raw: Sample[];
    summaries: Record<string, Record<string, Stats>>;
    profiles: ProfileEvidence[];
    timingPoints: typeof timingPoints;
    reproduction: {
        reproducedInProduction: boolean; intervalMs: number[]; sampleIds: string[]; statistics: Stats;
        representative: {sampleId: string; composition: Record<string, number>} | null; developmentMeasured: boolean;
        developmentRequired: boolean; developmentCompleted: boolean; developmentSampleIds: string[]; developmentStatistics: Stats;
        developmentRepresentative: {sampleId: string; composition: Record<string, number>} | null;
    };
    diagnostics: string[];
    productionProvenance?: ProductionProvenance;
};

function statisticalTable(items: Record<string, Stats>): string {
    const rows = Object.entries(items).map(([label, values]) => {
        const display = [values.p50, values.p95, values.min, values.max].map((number) => number === null ? "未取得" : number.toFixed(2));
        return `| ${label} | ${values.count} | ${display.join(" | ")} |`;
    });
    return ["| 场景或阶段（单位 ms；次数与字节表另标） | 样本数 | p50 | p95 | 最小 | 最大 |", "|---|---:|---:|---:|---:|---:|", ...rows].join("\n");
}

export function markdownReport(report: MeasurementReport): string {
    const {summaries, reproduction} = report;
    const duration = summaries.duration ?? {};
    const forScenario = (scenario: string): Record<string, Stats> => Object.fromEntries(Object.entries(duration).filter(([key]) => key.includes(`/${scenario}/`)));
    const counts = Object.entries(report.sample.categoryCounts).map(([category, count]) => `${category}: ${count} (${(100 * count / report.sample.fileCount).toFixed(2)}%)`).join("；");
    const profileRows = report.profiles.map((profile) => `| ${profile.label} | ${profile.kind} | ${profile.cpu?.sampleCount ?? 0} | ${JSON.stringify(profile.cpu?.categories ?? {})} | ${profile.artifacts.map((artifact) => `${artifact.path} (${artifact.bytes} bytes)`).join("；")} |`);
    const passCount = report.raw.filter((sample) => sample.status === "pass").length;
    const stageNames: Record<string, string> = {clickToActivation: "点击至 activation（含单击等待）", activationToReadEnd: "activation 至 read 响应末尾", readEndToSession: "响应末尾至 session 发布", sessionToView: "session 至 view 发布", viewToEditable: "view 发布至可编辑并跨帧确认"};
    const representativeRows = Object.entries(reproduction.representative?.composition ?? {}).map(([name, value]) => `| ${stageNames[name] ?? name} | ${value.toFixed(2)} |`);
    const developmentRows = Object.entries(reproduction.developmentRepresentative?.composition ?? {}).map(([name, value]) => `| ${stageNames[name] ?? name} | ${value.toFixed(2)} |`);
    const criteria = [
        ...Object.entries(duration).filter(([key]) => key.startsWith("production/A/")).map(([key, value]) => ({key, value, target: key.endsWith("service-cold") ? 1_000 : 300})),
        ...Object.entries(duration).filter(([key]) => key.startsWith("production/C/")).map(([key, value]) => ({key, value, target: key.includes("/cold-") ? 200 : 100})),
    ].map(({key, value, target}) => `| ${key} | ${target} | ${value.p95?.toFixed(2) ?? "未取得"} | ${value.p95 === null ? "未判定" : value.p95 <= target ? "p95 达到" : "p95 超出"} |`);
    const coldSwitch = report.raw.filter((sample) => sample.status === "pass" && sample.scenario === "C" && sample.variant.startsWith("cold-"));
    const coldReadCount = stats(coldSwitch.map((sample) => sample.requests.filter((request) => new URL(request.name).pathname === "/api/workspace-files/read").length));
    const projectStages: Record<string, Stats> = {};
    for (const variant of ["service-cold", "reopen"]) {
        const values: Record<string, number[]> = {"点击至 open 响应结束": [], "open 响应结束至 tree 响应结束": [], "tree 响应结束至可操作": []};
        for (const sample of report.raw.filter((item) => item.status === "pass" && item.environment === "production" && item.scenario === "A" && item.variant === variant)) {
            const open = sample.requests.find((item) => new URL(item.name).pathname === "/api/projects/open");
            const tree = sample.requests.find((item) => new URL(item.name).pathname === "/api/workspace-files/tree");
            if (!open || !tree) continue;
            values["点击至 open 响应结束"]!.push(open.responseEnd - sample.operationStartTime);
            values["open 响应结束至 tree 响应结束"]!.push(tree.responseEnd - open.responseEnd);
            values["tree 响应结束至可操作"]!.push(sample.operationEndTime - tree.responseEnd);
        }
        for (const [stage, durations] of Object.entries(values)) projectStages[`${variant}/${stage}`] = stats(durations);
    }
    const editorProfiles = report.profiles.filter((profile) => profile.kind === "browser" && profile.sample?.scenario === "C" && profile.cpu);
    const traverseRows = editorProfiles.map((profile) => {
        const traverse = profile.cpu!.categories["Vue 深度遍历"] ?? 0;
        return `| ${profile.label} | ${profile.cpu!.spanMs.toFixed(2)} | ${traverse.toFixed(2)} | ${(100 * traverse / profile.cpu!.spanMs).toFixed(2)}% |`;
    });
    const serverRows = report.profiles.filter((profile) => profile.kind === "server" && profile.cpu).flatMap((profile) => Object.entries(profile.cpu!.categories)
        .map(([category, duration]) => `| ${profile.label}/${category} | ${duration.toFixed(2)} | ${(100 * duration / profile.cpu!.spanMs).toFixed(2)}% |`));
    const switchingRequests = report.raw.filter((sample) => sample.status === "pass" && sample.scenario === "C");
    const hotSamples = switchingRequests.filter((sample) => sample.variant.startsWith("hot-"));
    const hotFileRequests = hotSamples.flatMap((sample) => sample.requests).filter((request) => /\/api\/workspace-files\/(?:stat|read)$/u.test(new URL(request.name).pathname));
    const productionSwitch = stats(switchingRequests.filter((sample) => sample.environment === "production").map((sample) => sample.durationMs));
    const developmentSwitch = stats(switchingRequests.filter((sample) => sample.environment === "development").map((sample) => sample.durationMs));
    return [
        "# Files 现状耗时基线", "", `生成时间：${report.generatedAt}；HEAD：${report.sourceRevision}；生产镜像身份详见 JSON build.image。`, "",
        `完整运行：${report.completed ? "通过" : "失败"}；有效样本 ${passCount}/${report.raw.length}。桌面版未测。`, "",
        "## A. 打开项目", "", statisticalTable(forScenario("A")), "",
        "服务冷开每次重启自有 Product；reopen 在同进程内关闭并再次打开。两者都会经历真实 Project Session 生命周期，OS 页缓存保持自然状态。", "",
        "### 打开项目的互斥区间", "", statisticalTable(projectStages), "",
        "三个区间在同一样本内相加等于打开总耗时；各列分位数不能相加。open 接口只等 required 模块 minimum-ready，File Index 在后台共享 warm-up，tree 请求等待完整快照。接口 wall-clock、frontmatter CPU 采样与前端 User Timing 分开解释。", "",
        "### 前端投影与建树", "", statisticalTable(Object.fromEntries(Object.entries(summaries.userTiming ?? {}).filter(([key]) => key.startsWith("production/A/") && /\/files\.tree\.(?:project|build)$/u.test(key)))), "",
        "tree 响应结束至可操作还包含 JSON 解码、响应状态提交、Vue 更新、DOM 渲染和两帧确认；不能把整个残余区间标为建树或纯渲染。代表 Chrome profile 与 Layout/UpdateLayoutTree/Paint 原始跟踪见下文。", "",
        "## B. 展开宽目录", "", statisticalTable(forScenario("B")), "",
        `目录 ${report.sample.wideDirectoryPath} 直接包含 ${report.sample.wideDirectoryChildren} 项。终点包括所有直接子行挂载与展开动画完成。最长完整 Long Task：`, "",
        statisticalTable(Object.fromEntries(Object.entries(summaries.longestTask ?? {}).filter(([key]) => key.includes("/B/")))), "",
        "当前服务发布完整 tree；B 是已收到快照的客户端展开，不新增按需目录协议。请求数见 JSON，不把零 tree 请求解释为已实现按需扫描。", "",
        "## C. 点击至正文可编辑", "", statisticalTable(forScenario("C")), "",
        "cold 是项目内首次打开的不同文件。hot-tree 从文件树单击两个已保留标签的文件；hot-tab 从标签按钮切换。富文本／源码、单组／双组独立记录，预热与 profiling 不进入常规统计。", "",
        `热切换 ${hotSamples.length} 次期间 stat/read 请求合计 ${hotFileRequests.length}；是否重建控件由固定 User Timing measure 与独立 CPU profile 交叉核对。没有 read 请求的热标签延迟不能归因服务端读文件。`, "",
        `冷开 read 次数：p50=${coldReadCount.p50?.toFixed(1) ?? "未取得"}，p95=${coldReadCount.p95?.toFixed(1) ?? "未取得"}；stat 与 read 每次计数见下表。`, "",
        "### 文件请求次数（单位：次）", "", statisticalTable(summaries.fileRequestCount ?? {}), "",
        "### 选中与标签反馈", "", statisticalTable(summaries.feedback ?? {}), "",
        "### 互斥关键路径区间", "", statisticalTable(summaries.composition ?? {}), "",
        "这些区间按时间线单调切分，相加等于该操作总耗时。无 read 的 hot 样本不虚构网络阶段。控件与解析 measure 是嵌套子阶段，不能再次相加。", "",
        "files.activation.read 虽然只包 read await，仍包含主线程排队、响应解码与 Promise continuation；与 Resource Timing 读请求时长不同。TipTap initialize 是解析/模型/控件与 onCreate 调度联合区间；Monaco mount 包括模块等待、nextTick/layout。它们不能解释成纯解析或纯创建。", "",
        "## D. 约 0.3 秒延迟", "",
        reproduction.reproducedInProduction ? `生产已出现 250–400 ms 操作，共 ${reproduction.sampleIds.length} 个；对应原始 C 样本 ID 保存在 reproduction.sampleIds，未复制样本充当新测量。` : "生产常规 C 样本未出现 250–400 ms 操作；开发对照是否完成见下文，不把较慢或较快操作自动称为约 0.3 秒复现。", "",
        statisticalTable({"生产 250–400 ms 样本": reproduction.statistics}), "",
        `代表样本：${reproduction.representative?.sampleId ?? "未取得"}。`, "",
        "| 区间 | 耗时 ms |", "|---|---:|", ...representativeRows, "",
        `开发模式对照：${reproduction.developmentCompleted ? "完整完成，与生产使用同一参数、不同合成项目；结果在 C 表中" : reproduction.developmentMeasured ? "已取得部分样本，尚未完整完成" : reproduction.developmentRequired ? "本轮需要补测，但未取得样本；失败见诊断" : "生产已复现，本轮未要求开发对照"}。`, "",
        statisticalTable({"开发 250–400 ms 样本": reproduction.developmentStatistics}), "",
        `开发代表样本：${reproduction.developmentRepresentative?.sampleId ?? "未取得"}。`, "",
        "| 区间 | 耗时 ms |", "|---|---:|", ...developmentRows, "",
        `本轮全部生产 C 的范围为 ${productionSwitch.min?.toFixed(2) ?? "未取得"}–${productionSwitch.max?.toFixed(2) ?? "未取得"} ms；开发 C 为 ${developmentSwitch.min?.toFixed(2) ?? "未取得"}–${developmentSwitch.max?.toFixed(2) ?? "未取得"} ms。未命中 250–400 ms 时，D 的 count=0、分位数为空，保留该结果，不用 B 的展开时长或小规模试跑代替正式切换。`, "",
        "## 与 t16、t24 的可比性", "",
        "t16/t24 在 Windows、Chromium 151.0.7922.34、Source Dev、1440×1000 下测两个 8 KiB permanent 标签，3×30 次；t24 富文本单组 p50/p95=33.5/38.0 ms，源码单组=43.5/53.8 ms。本轮是 Linux、headless Chrome、生产构建、约 3000 个 5–30 KiB 文件，每格 30 次，输入证明逐样本进行。视口和 capture-click 起点相同，但构建、平台、文件大小、工程规模与跨帧终点不同，不能直接计算回归幅度。", "",
        "仅 hot-tab 的入口与历史标签切换对应；hot-tree 保留既有 180 ms 单击等待，不与 t24 标签值直接比较。双组 hot-tab 也保留为补充，本轮要求的单组富文本／源码两格均有独立样本。", "",
        "## 网络与阶段分解", "",
        "### 每次操作请求总数（单位：次）", "", statisticalTable(summaries.requestCount ?? {}), "",
        "### 每个请求耗时", "", statisticalTable(summaries.requestDuration ?? {}), "",
        "### 每个请求响应体大小（单位：bytes，encodedBodySize）", "", statisticalTable(summaries.requestBytes ?? {}), "",
        "### 首字节等待（服务执行与排队均在此内）", "", statisticalTable(summaries.firstByteWait ?? {}), "",
        "### 响应体传输", "", statisticalTable(summaries.transfer ?? {}), "",
        "### Server-Timing", "", statisticalTable(summaries.serverTiming ?? {}), "",
        "### User Timing", "", statisticalTable(summaries.userTiming ?? {}), "",
        "### 各操作最长主线程任务", "", statisticalTable(summaries.longestTask ?? {}), "",
        "## 性能标准对照", "",
        "采用 p95 与规范时限作对照；规范本身没有指定分位数，因此本表是报告约定，不是改写产品合同。", "",
        "| 变体 | 规范时限 ms | 实测 p95 ms | 结果 |", "|---|---:|---:|---|", ...criteria, "",
        "## 测量设计与环境", "",
        `- 固定种子 ${report.sample.seed}，生成 ${report.sample.fileCount} 个 Markdown，${report.sample.minBytes}–${report.sample.maxBytes} bytes，合成文件共 ${report.sample.totalBytes} bytes；${counts}。产品创建时的默认模板文件保留，fileCount/totalBytes 只统计生成器。普通主体目录深度 3–5 层；index.md 与宽目录是明确的浅层入口。`,
        "- 用真实 POST /api/projects 创建项目后写入返回 projectRoot 对应的隔离 State Root；项目卡片的真实 click 发起打开。rich 与 source 使用不同项目，避免旧标签与分组恢复污染。",
        `- 起止判定：${JSON.stringify(report.methodology)}。`,
        "- 样本统计保留 Resource Timing、Server-Timing、固定名字的 User Timing measure、Long Tasks、Long Animation Frames 原始条目；每个样本记录 loadAverage。常驻计时不生成 mark 或序号名字。",
        `- 环境：${JSON.stringify(report.environment)}。`,
        `- State Root：${report.sample.stateRoot}；样本、State Root 与独立 Chrome profile 已清理=${report.sample.cleanedAfterRun}；仅超限 profiling 文件留存=${JSON.stringify(report.sample.retainedProfiles)}。`,
        `- 构建日志：${report.build.logPath}；命令与逐次服务启动日志与报告同目录。`, "",
        ...(report.productionProvenance ? [`- 生产矩阵续跑来源：${JSON.stringify(report.productionProvenance)}。历史失败不计为本轮诊断，原报告与 raw 保持原样；本轮只补开发 C 与代表项目打开 profiling。`, ""] : []),
        "## 跟踪与 CPU 采样", "",
        "| 运行 | 采样对象 | CPU 样本数 | 分类采样区间 ms | 原始文件 |", "|---|---|---:|---|---|", ...profileRows, "",
        "### 服务代表窗口构成", "",
        "| 代表运行与类别 | 分类采样区间 ms | 占打开窗口 |", "|---|---:|---:|", ...serverRows, "",
        "这些类别分配相邻采样时间戳区间，不是精确 CPU 活跃时间；原生、异步 I/O 与稀疏采样间隔仍可能归到当前栈，未归类不自动解释为 CPU 或磁盘。服务 timeDeltas 原值与 topFunctions 保留在 JSON/profile，复核时不能仅凭压缩名认定热点。", "",
        "### 切换代表窗口的 Vue 深度遍历", "",
        "| 代表运行 | 操作窗口 ms | traverse 分类采样区间 ms | 占窗口 |", "|---|---:|---:|---:|", ...traverseRows, "",
        "同名函数必须匹配脚本 URL 与函数行列范围后才计入 traverse。该证据定位到 Vue 深度 watch/effect 的同步工作；Pinia/persist 的具体订阅因果尚无禁用订阅等干预实验。控件创建与网络小并不等同于全部剩余延迟都来自同一订阅。", "",
        "服务 CPU profile 使用 Bun --cpu-prof，采样真正 .output/server/index.mjs 进程；按 performance.timeOrigin 与 startTime 对齐，只统计代表性打开窗口。parseMarkdownDocument、scanWorkspaceTree、visitPath、buildWorkspaceNode、createProjectIssues、readWorkspaceTextFile 在本次构建 AST 中以独特函数体识别，记录压缩名、行列与 matchedBy；仅唯一匹配映射参与祖先栈归类。frontmatter 优先于其外层索引栈，未归类部分保留；CPU 采样不等于异步 I/O wall-clock。",
        "Chrome 使用 1000 µs CPU sampling 和 devtools.timeline/blink.user_timing/v8.execute trace。独立采样脚本的 files.baseline.profile-clock mark 对齐 monotonic 微秒时钟；只统计 sample click-to-ready 窗口，trace 只取同 pid/tid 页面主线程。Vue traverse 以 __v_skip/new Map/Object.getOwnPropertySymbols/propertyIsEnumerable 独特函数体唯一识别，匹配真实脚本 URL 与函数行列范围后归为 Vue 深度遍历；其余按 parseMarkdown/createDoc/createSchema/DOMParser 归类解析与模型、EditorView/createView/updateState 归类富文本控件、Monaco model/widget/tokenizer、建树和 Vue 祖先栈归类。未识别部分保留未归类。Layout/UpdateLayoutTree/Paint 与 RunTask/FunctionCall 嵌套，不能相加。独立时钟 mark 会立即清理，不进入常规样本。", "",
        "CPU 时间重建：累加 timeDeltas 得到时间戳后排序，再按非重叠相邻区间归类；负 delta 数量保留于 cpu.negativeDeltaCount，原始 profile 不改写。协议参考：[CDP Profiler Profile](https://chromedevtools.github.io/devtools-protocol/tot/Profiler/#type-Profile)。Monaco 原生输入宿主的判据来自已安装版本 nativeEditContext.js，并由键盘 smoke 实证。", "",
        "## 常驻计时点", "",
        "| 文件 | 名字 | 所有者边界 |", "|---|---|---|", ...report.timingPoints.map((point) => `| ${point.file} | ${point.name} | ${point.boundary} |`), "",
        "## 局限与可疑数据", "",
        "1. 桌面版未测；headless Chrome 的调度与开发者日常浏览器不同。",
        "2. 服务冷开不清 OS 页缓存，reopen 仍包含 Project module 重建。",
        "3. Long Task 仅记录 >=50 ms 的完整任务，未出现记录不代表不存在较短阻塞；B 包含既有展开动画。",
        "4. 常规样本包含常驻计时开销；独立 trace/profile 有额外开销，只用于构成分析。CPU 采样分类不是异步 wall-clock 的精确分割。",
        "5. 正文输入证明位于计时窗口外，输入并撤销只用合成文件；跨帧终点含最多约两帧确认成本。", "",
        "## 诊断", "", report.diagnostics.length ? report.diagnostics.join("\n\n") : "无未处理测量失败。", "",
        "diagnostics 只记录脚本异常与收口失败；浏览器 pageerror、console.error、开发优化重载及健康检查重试保留在运行日志。完整运行通过表示测量矩阵、代表 profiling 和清理完成，不表示准备阶段没有产品异常。", "",
    ].join("\n");
}
