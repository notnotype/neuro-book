import {existsSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {Command} from "commander";
import {globSync} from "tinyglobby";
import {loadConfig} from "./config";
import {DEFAULT_NAMESPACE_ALIASES} from "./namespaces";
import {loadRules} from "./rules";
import {computeMaskedRanges, mergeRanges} from "./markdown-mask";
import {countableVisibleChars, prepareScanContext} from "./scan-context";
import {buildLineStarts, locatePosition, scanHandlerRules, scanWithContext} from "./scanner";
import {scanDensity} from "./density";
import {applyAutoFix} from "./fix";
import {createCheckJsonReport, createFixJsonReport, createMultiCheckJsonReport, createRulesJsonReport, formatCheckAggregate, formatCheckReport, formatFixReport, formatJsonReport, formatRules, hasHighLevelIssue, summarizeIssues} from "./reporter";
import {ruleDetectorKind} from "./rule-registry";
import {buildGuide, GUIDE_TIERS, parseRuleVerdicts, type GuideTier, type RuleVerdicts} from "./guide";
import {readDetectCache, detectCacheKey, writeDetectCache} from "./detect/cache";
import {chunkBySentence} from "./detect/chunk";
import {aggregate, defaultDetectorOptions, HfTransport, type DetectPayload, type DetectorTransport} from "./detect/transport";
import {loadUserSettings, saveUserSettings, userCacheDir} from "./user-state";
import {beginRound, computeRoundMetrics} from "./round";
import {contribute, listOutbox, outboxDir} from "./contribute";
import {buildReport} from "./report";
import {LLMLINT_VERSION} from "./version";
import type {ActiveRuleRecord, CheckFileEntry, CheckFilterInfo, DensityIssue, FixFileResult, Issue, LlmlintOutput, MaskedRange, RegexRuleRecord, Review, RuleDetectorKind, RuleLevel} from "./types";
import type {SharingMode, SharingTier, UserSettings} from "./user-state";

type GlobalOptions = {
    config?: string;
    format?: string;
    minLevel?: string;
    review?: string;
    scanAll?: boolean;
    showLines?: boolean;
    /** JSON 输出内联完整规则对象；缺省为紧凑形态（规则元数据去重到顶层 rules）。 */
    ruleDetail?: boolean;
    write?: boolean;
    /** commander 的 --no-cache 会落成 cache:false。 */
    cache?: boolean;
    noCache?: boolean;
    /** rules：按判据类别过滤。 */
    detector?: string;
    /** rules：按 namespace 过滤。 */
    namespace?: string;
    /** guide：摘要档位。 */
    tier?: string;
    /** guide：eval 报告路径，提供判别力档位。 */
    profile?: string;
};

/** 单文件检查结果（含逐文件隐藏统计，供 stylish 逐文件表头使用）。 */
type FileResult = CheckFileEntry & {hiddenByReview: number; hiddenByLevel: number};
type DetectFileResult = DetectPayload & {filePath: string; cached: boolean; content: string};
/** 报告层的单个 chunk：在缓存 payload 之外补文内位次与相对偏离。 */
type DetectChunkReport = DetectPayload["chunks"][number] & {
    /** 文内 P(AI) 降序位次，1 起。用于取文内两端（最可疑 / 最不可疑），取代绝对阈值。 */
    rank: number;
    /** 相对文档均值的偏离（pAi − docPAi）。正=比本篇平均更可疑。 */
    relative: number;
    /** chunk 开头可见字符预览，免去消费者按 span 偏移自行切原文。 */
    preview?: string;
};
type DetectFileReport = {
    filePath: string;
    docPAi: number;
    maxPAi: number;
    /**
     * 文内 P(AI) 极差（max − min）。低于 DETECT_SPREAD_FLOOR 时四象限对这篇不适用；
     * chunk 少于 2 个时为 0。
     */
    spread: number;
    cached: boolean;
    chunks: DetectChunkReport[];
};

/** 整篇层（绝对）判据：docPAi 达到该值即「这篇整体可疑」。只用于整篇结论，不用于挑文内段落。 */
const DETECT_DOC_SUSPICIOUS = 0.85;
/**
 * 文内 P(AI) 极差下限。低于它说明 chunk 之间没有可分辨的高低差——
 * 整篇 AI 生成的文本常常全部 chunk 都在 0.98 以上，此时文内两端之分只是噪声，
 * 四象限（规则信号 × 检测热力）给不出可执行结论，应改用规则信号密度排优先级。
 *
 * 未校准：只在一篇 spread 0.707 的样本上定过方向，那篇没有触及边界。改动前先在多篇实测上校准，
 * 不要因为单篇观感调这个数。提示词侧已声明它是起点而非定论。
 */
const DETECT_SPREAD_FLOOR = 0.15;
/**
 * 门槛两侧的边界带半宽：`spread` 落在 FLOOR ± 该值之内时，位次只是弱证据。
 *
 * 阈值本身未校准，所以「刚好过线」和「远超过线」不该呈现成同一回事——实测第二篇样本
 * spread 0.167，距门槛仅 0.017 就走了完整四象限分支。带宽与提示词侧写明的 0.10–0.20
 * 同源，刻意不引入第二个独立魔数。
 */
const DETECT_SPREAD_MARGIN = 0.05;

const OUTPUTS = new Set<LlmlintOutput>(["stylish", "json"]);
const LEVELS = new Set<RuleLevel>(["high", "medium", "low"]);
const REVIEWS = new Set<Review | "all">(["agent", "human", "none", "all"]);
const DETECTOR_KINDS = new Set<RuleDetectorKind>(["regex", "density", "handler", "semantic"]);
const LEVEL_RANK: Record<RuleLevel, number> = {
    high: 3,
    medium: 2,
    low: 1,
};
const CONFIG_KEYS = [
    "initialized",
    "sharing.tier",
    "sharing.mode",
    "sharing.anonymous",
    "detector.proxy",
    "detector.space",
    "detector.chunkChars",
    "detector.minIntervalMs",
] as const;
type ConfigKey = typeof CONFIG_KEYS[number];

/**
 * llmlint 命令行入口。CLI 只做参数解析和错误出口，规则行为由模块提供。
 */
export async function runCli(argv: string[]): Promise<void> {
    // runCli 可被测试或宿主进程多次调用；每轮都应独立计算退出码。
    process.exitCode = 0;
    const program = new Command();

    program
        .name("llmlint")
        .description([
            "中文正文的套路化表达 / AI 写作痕迹 / 节奏问题规则库，两种用法：",
            "  写之前：guide 输出写作约束要点，可注入系统提示词；rules 检视规则库。",
            "  写之后：check 定位候选、fix 机械修复、detect 估算 P(AI)。",
        ].join("\n"))
        .version(LLMLINT_VERSION)
        .addHelpCommand(false)
        .option("-c, --config <path>", "指定 llmlint.config.ts 路径")
        .option("-f, --format <format>", "输出格式：stylish 或 json");

    program
        .command("status")
        .description("显示 llmlint 用户状态、项目配置路径与检测器设置")
        .option("-f, --format <format>", "输出格式：stylish 或 json")
        .action(async (commandOptions: GlobalOptions | Command) => {
            try {
                const options = mergeOptions(program, commandOptions);
                await showStatus(options);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    const configCommand = program
        .command("config")
        .description("管理用户级 settings.json；不会修改项目级 llmlint.config.ts")
        .addHelpText("after", `\n合法键：${CONFIG_KEYS.join(", ")}`);

    configCommand
        .command("get")
        .description("读取用户级 settings.json 的归一设置；不读取项目级 llmlint.config.ts")
        .argument("[key]", "可选 dot-path；省略时输出完整 JSON")
        .action(async (key: string | undefined) => {
            try {
                await configGet(key);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    configCommand
        .command("set")
        .description("写入用户级 settings.json 的白名单键；不会修改项目级 llmlint.config.ts")
        .argument("<key>", "dot-path 白名单键")
        .argument("<value>", "值；true/false、数字、null 会按类型解析")
        .action(async (key: string, value: string) => {
            try {
                await configSet(key, value);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    program
        .command("check")
        .description("检查文件或目录中的 regex rule 候选问题（目录递归 .md/.markdown/.txt）")
        .argument("<files...>", "要检查的 UTF-8 文本文件或目录，可传多个")
        .option("-f, --format <format>", "输出格式：stylish 或 json")
        .option("--min-level <level>", "只显示该级别及以上的问题：high、medium 或 low")
        .option("--review <scope>", "按审查受众过滤：agent（默认）、human、none 或 all")
        .option("--scan-all", "关闭 Markdown 区域遮罩，扫描代码块 / 链接等全部内容")
        .option("--show-lines", "在 stylish 输出中显示完整命中行")
        .option("--rule-detail", "JSON 输出内联完整规则对象（detector / source / scope）与逐 namespace 明细；缺省为紧凑形态")
        .action(async (files: string[], commandOptions: GlobalOptions | Command) => {
            try {
                const options = mergeOptions(program, commandOptions);
                await checkFiles(files, options);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    program
        .command("fix")
        .description("应用 fixability:auto 的确定性机械修复（零宽字符、省略号/破折号尾部清理）；默认 dry-run，加 --write 落盘")
        .argument("<files...>", "要修复的 UTF-8 文本文件或目录，可传多个")
        .option("-f, --format <format>", "输出格式：stylish 或 json")
        .option("--write", "把修复写回原文件（缺省只预览，不改文件）")
        .option("--scan-all", "关闭 Markdown 区域遮罩，连代码块 / frontmatter 一并修复")
        .action(async (files: string[], commandOptions: GlobalOptions | Command) => {
            try {
                const options = mergeOptions(program, commandOptions);
                await fixFiles(files, options);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    program
        .command("guide")
        .description("输出写作期规则摘要（markdown）：动笔之前的写作约束，可直接注入系统提示词")
        .option("--tier <tier>", `摘要档位（由窄到宽）：${GUIDE_TIERS.join(" < ")}；缺省 standard`)
        .option("--profile <path>", "eval 报告 JSON 路径；提供后按判别力把 strong 规则并入 core、weak 并入 wide")
        .addHelpText("after", [
            "",
            "档位含义：",
            "  core      语义规则（静态判据不存在，只能靠读）+ profile 里判别力 strong 的",
            "  standard  再加建议类规则（CLI 能定位症状，但改法要重写整句）",
            "  wide      再加 profile 里判别力 weak 的",
            "  full      再加词表类规则（逐词替换与定点删除）",
            "",
            "规则的启停沿用项目级 llmlint.config.ts，例如关掉 vocabulary.r18 后它不会出现在摘要里。",
        ].join("\n"))
        .action(async (commandOptions: GlobalOptions | Command) => {
            try {
                const options = mergeOptions(program, commandOptions);
                await showGuide(options);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    program
        .command("rules")
        .description("检视当前配置下启用的规则库；语义规则展开完整判定说明与示例")
        .option("-f, --format <format>", "输出格式：stylish 或 json")
        .option("--detector <kind>", "按判据类别过滤：regex、density、handler 或 semantic")
        .option("--namespace <namespace>", "按 namespace 过滤；支持中文 alias")
        .action(async (commandOptions: GlobalOptions | Command) => {
            try {
                const options = mergeOptions(program, commandOptions);
                await showRules(options);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    program
        .command("detect")
        .description("调用外部神经检测器估算文本 P(AI)，结果按正文哈希缓存")
        .argument("<files...>", "要检测的 UTF-8 文本文件或目录，可传多个")
        .option("-f, --format <format>", "输出格式：stylish 或 json")
        .option("--no-cache", "跳过缓存读取，但成功检测后仍写入新缓存")
        .action(async (files: string[], commandOptions: GlobalOptions | Command) => {
            try {
                const options = mergeOptions(program, commandOptions);
                await detectFiles(files, options);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}\n可运行 llmlint config set detector.proxy http://127.0.0.1:7890 配置代理`);
                process.exitCode = 1;
            }
        });

    const report = program
        .command("report")
        .description("把 check + detect 的 JSON 合成审稿报告（静态分级 + 密度指纹 + 四象限交叉）")
        .option("--check <path>", "check --format json 的输出文件（必需）")
        .option("--detect <path>", "detect --format json 的输出文件；缺省只做静态部分")
        .option("--density-threshold <n>", "四象限「规则密集」的 chunk 内命中下限（默认 3）")
        .option("--min-level <level>", "只统计不低于该级别的命中：high / medium / low（默认 low）")
        .action(async (commandOptions: {check?: string; detect?: string; densityThreshold?: string; minLevel?: string}) => {
            try {
                const checkPath = commandOptions.check;
                if (!checkPath) {
                    throw new Error("report 需要 --check <check.json>（check --format json 的输出文件）");
                }
                const checkJson = JSON.parse(readFileSync(checkPath, "utf-8"));
                const detectJson = commandOptions.detect
                    ? JSON.parse(readFileSync(commandOptions.detect, "utf-8"))
                    : null;
                const threshold = Number(commandOptions.densityThreshold ?? 3);
                if (!Number.isFinite(threshold) || threshold < 1) {
                    throw new Error("--density-threshold 必须是 ≥1 的数字");
                }
                const minLevel = commandOptions.minLevel ?? "low";
                if (!LEVELS.has(minLevel as RuleLevel)) {
                    throw new Error(`--min-level 必须是 ${[...LEVELS].join(" / ")} 之一`);
                }
                process.stdout.write(buildReport(checkJson, detectJson, {densityThreshold: threshold, minLevel: minLevel as RuleLevel}) + "\n");
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    const round = program
        .command("round")
        .description("多轮修订谱系：把一轮审稿的修前快照、计划、修后稿与检测产物收在同一个目录");

    round
        .command("begin")
        .description("起一轮：建轮目录、快照修前正文、在台账追加条目，输出轮号与目录")
        .argument("<files...>", "本轮要审的 UTF-8 文本文件，可传多个")
        .option("--parent <round>", "本轮续修哪一轮的 output；另起一篇时不传")
        .action(async (files: string[], commandOptions: {parent?: string}) => {
            try {
                await beginRoundCommand(files, commandOptions.parent);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    round
        .command("metrics")
        .description("读轮目录的 check/detect JSON，输出台账 summary/retest 需要的指标与复测 verdict 建议")
        .argument("<round>", "轮号")
        .option("-f, --format <format>", "输出格式：stylish 或 json")
        .action(async (roundArg: string, commandOptions: {format?: string}) => {
            try {
                const options = mergeOptions(program, commandOptions);
                const parsed = Number.parseInt(roundArg, 10);
                if (!Number.isInteger(parsed) || parsed < 1) {
                    throw new Error(`轮号必须是正整数，当前为 ${roundArg}`);
                }
                const result = computeRoundMetrics(process.cwd(), parsed);
                if (resolveOutput("stylish", options.format) === "json") {
                    console.log(JSON.stringify({kind: "round-metrics", ...result}, null, 2));
                } else {
                    console.log([
                        `round: ${result.round}`,
                        `dir: ${result.dir}`,
                        `staticIssues: ${result.staticIssues ?? "—"}`,
                        `densityIssues: ${result.densityIssues ?? "—"}`,
                        `docPAi: ${result.docPAi === null ? "—" : result.docPAi.toFixed(3)}`,
                        `spread: ${result.spread === null ? "—" : result.spread.toFixed(3)}`,
                        `verdict: ${result.verdict ?? "—（未复测）"}`,
                        ...(result.message.length > 0 ? [`提示: ${result.message.join("；")}`] : []),
                    ].join("\n"));
                }
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    program
        .command("contribute")
        .description("把已完成的审稿轮按共享档位裁剪，只写本地发件箱，不联网、不发送")
        .option("--yes", "真写发件箱；缺省只列出将导出什么")
        .option("--round <round>", "只导出指定轮")
        .option("--auto", "由用户设置决定落 / 跳过 / 待确认（五步流程步骤 5 用这个）")
        .option("--list", "列出发件箱里现有的条目")
        .action(async (commandOptions: {yes?: boolean; round?: string; auto?: boolean; list?: boolean}) => {
            try {
                await contributeCommand(commandOptions);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    await program.parseAsync(argv);
}

/** round begin：解析 --parent 后交给 round 模块，打印轮号与目录供 Agent 后续命令拼路径。 */
async function beginRoundCommand(files: string[], parent: string | undefined): Promise<void> {
    let parentRound: number | null = null;
    if (parent !== undefined) {
        const parsed = Number.parseInt(parent, 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
            throw new Error(`--parent 必须是正整数轮号，当前为 ${parent}。`);
        }
        parentRound = parsed;
    }
    const result = beginRound({cwd: process.cwd(), files, parentRound});
    const relative = toPosix(result.dir.slice(process.cwd().length + 1));
    console.log([
        `round: ${result.round}`,
        `dir: ${relative}`,
        `source: ${result.snapshots.map((name) => `${relative}/source/${name}`).join("、")}`,
        `parent: ${parentRound === null ? "null（另起一篇）" : String(parentRound)}`,
        "",
        "下一步：",
        `  1. check --review all --format json > ${relative}/check-source.json`,
        `  2. detect --format json > ${relative}/detect-source.json`,
        `  3. report --check ${relative}/check-source.json --detect ${relative}/detect-source.json（合成审稿报告）`,
        "  4. 生成 plan.md → 用户审批 → 修复到 output/",
        `  5. 复测：check / detect 落 ${relative}/check-output.json、detect-output.json`,
        `  6. round metrics ${result.round}（算台账指标与 verdict）→ contribute --auto --round ${result.round}`,
    ].join("\n"));
}

/** contribute：--list 单独走一条；其余交给 contribute 模块，这里只负责把结果说人话。 */
async function contributeCommand(options: {yes?: boolean; round?: string; auto?: boolean; list?: boolean}): Promise<void> {
    if (options.list === true) {
        const entries = listOutbox();
        if (entries.length === 0) {
            console.log(`发件箱为空：${outboxDir()}`);
            return;
        }
        console.log(`发件箱 ${outboxDir()}（共 ${entries.length} 条，可直接删除文件或整个目录）：`);
        for (const entry of entries) {
            console.log(`  ${entry.file}  ${entry.kind}/${entry.tier}  ${entry.bytes} 字节  ${entry.createdAt}`);
        }
        return;
    }
    let round: number | null = null;
    if (options.round !== undefined) {
        const parsed = Number.parseInt(options.round, 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
            throw new Error(`--round 必须是正整数轮号，当前为 ${options.round}。`);
        }
        round = parsed;
    }
    const result = await contribute({
        cwd: process.cwd(),
        round,
        write: options.yes === true,
        auto: options.auto === true,
    });
    if (result.action === "skipped") {
        console.log(result.reason ?? "未导出。");
        return;
    }
    for (const entry of result.skipped) {
        console.log(`跳过第 ${entry.round} 轮：${entry.reason}`);
    }
    if (result.written.length === 0) {
        console.log("没有待导出的轮。");
        return;
    }
    for (const entry of result.written) {
        const degraded = entry.degradedFrom === null ? "" : `（原设 ${entry.degradedFrom} 档，缺修后正文，已降级）`;
        const target = entry.file === null ? "未落盘" : entry.file;
        console.log(`第 ${entry.round} 轮 → ${entry.tier} 档 ${entry.bytes} 字节 ${degraded}${entry.file === null ? "" : ` → ${target}`}`);
    }
    if (result.action === "wrote") {
        console.log(`已写入 ${outboxDir()}；用 llmlint contribute --list 查看，删除文件即撤回。`);
    } else {
        console.log(result.reason ?? "以上为预览，加 --yes 才会写入发件箱。");
    }
}

async function showStatus(options: GlobalOptions): Promise<void> {
    const settings = loadUserSettings();
    const {configPath} = await loadConfig({cwd: process.cwd(), configPath: options.config});
    const report = {
        kind: "status" as const,
        version: LLMLINT_VERSION,
        initialized: settings.initialized,
        login: "none" as const,
        sharing: settings.sharing,
        configPath,
        detector: {
            space: settings.detector.space,
            proxyConfigured: settings.detector.proxy !== null,
            cacheDir: userCacheDir(),
        },
    };
    const output = resolveOutput("stylish", options.format);
    console.log(output === "json" ? JSON.stringify(report, null, 2) : formatStatus(report));
}

type StatusReport = {
    kind: "status";
    version: string;
    initialized: boolean;
    login: "none";
    sharing: UserSettings["sharing"];
    configPath: string | null;
    detector: {
        space: string;
        proxyConfigured: boolean;
        cacheDir: string;
    };
};

/** status stylish 输出：每行一个状态，便于 Agent/人直接读。 */
function formatStatus(report: StatusReport): string {
    return [
        `llmlint ${report.version}`,
        `initialized: ${report.initialized}`,
        `login: ${report.login}`,
        `sharing.tier: ${report.sharing.tier}`,
        `sharing.mode: ${report.sharing.mode}`,
        `sharing.anonymous: ${report.sharing.anonymous}`,
        `configPath: ${report.configPath ?? "null"}`,
        `detector.space: ${report.detector.space}`,
        `detector.proxyConfigured: ${report.detector.proxyConfigured}`,
        `detector.cacheDir: ${report.detector.cacheDir}`,
    ].join("\n");
}

async function configGet(rawKey: string | undefined): Promise<void> {
    const settings = loadUserSettings();
    if (rawKey === undefined) {
        console.log(JSON.stringify(settings, null, 4));
        return;
    }
    const key = normalizeConfigKey(rawKey);
    console.log(`${key} = ${JSON.stringify(readConfigValue(settings, key))}`);
}

async function configSet(rawKey: string, rawValue: string): Promise<void> {
    const key = normalizeConfigKey(rawKey);
    const value = parseConfigValue(rawValue);
    const settings = loadUserSettings();
    const next = applyConfigValue(settings, key, value);
    saveUserSettings(next);
    console.log(`${key} = ${JSON.stringify(readConfigValue(next, key))}`);
}

function normalizeConfigKey(key: string): ConfigKey {
    if (CONFIG_KEYS.includes(key as ConfigKey)) {
        return key as ConfigKey;
    }
    throw new Error(`未知配置键: ${key}。合法键：${CONFIG_KEYS.join(", ")}`);
}

function parseConfigValue(value: string): string | number | boolean | null {
    if (value === "true") {
        return true;
    }
    if (value === "false") {
        return false;
    }
    if (value === "null") {
        return null;
    }
    if (/^-?\d+$/u.test(value)) {
        return Number(value);
    }
    return value;
}

function applyConfigValue(settings: UserSettings, key: ConfigKey, value: string | number | boolean | null): UserSettings {
    const next: UserSettings = {
        version: settings.version,
        initialized: settings.initialized,
        sharing: {...settings.sharing},
        detector: {...settings.detector},
    };

    if (key === "initialized") {
        next.initialized = requireBoolean(value, key);
    } else if (key === "sharing.tier") {
        next.sharing.tier = requireSharingTier(value, key);
    } else if (key === "sharing.mode") {
        next.sharing.mode = requireSharingMode(value, key);
    } else if (key === "sharing.anonymous") {
        next.sharing.anonymous = requireBoolean(value, key);
    } else if (key === "detector.proxy") {
        next.detector.proxy = value === null || value === "" ? null : requireString(value, key);
    } else if (key === "detector.space") {
        next.detector.space = requireString(value, key);
    } else if (key === "detector.chunkChars") {
        next.detector.chunkChars = requirePositiveInteger(value, key);
    } else {
        next.detector.minIntervalMs = value === null ? null : requireNonNegativeInteger(value, key);
    }
    return next;
}

function readConfigValue(settings: UserSettings, key: ConfigKey): string | number | boolean | null {
    if (key === "initialized") return settings.initialized;
    if (key === "sharing.tier") return settings.sharing.tier;
    if (key === "sharing.mode") return settings.sharing.mode;
    if (key === "sharing.anonymous") return settings.sharing.anonymous;
    if (key === "detector.proxy") return settings.detector.proxy;
    if (key === "detector.space") return settings.detector.space;
    if (key === "detector.chunkChars") return settings.detector.chunkChars;
    return settings.detector.minIntervalMs;
}

function requireBoolean(value: string | number | boolean | null, key: ConfigKey): boolean {
    if (typeof value !== "boolean") {
        throw new Error(`${key} 必须是 true 或 false。`);
    }
    return value;
}

function requireString(value: string | number | boolean | null, key: ConfigKey): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${key} 必须是非空字符串。`);
    }
    return value;
}

function requirePositiveInteger(value: string | number | boolean | null, key: ConfigKey): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
        throw new Error(`${key} 必须是正整数。`);
    }
    return value;
}

function requireNonNegativeInteger(value: string | number | boolean | null, key: ConfigKey): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new Error(`${key} 必须是非负整数或 null。`);
    }
    return value;
}

function requireSharingTier(value: string | number | boolean | null, key: ConfigKey): SharingTier {
    if (value === "off" || value === "stats" || value === "fragments" || value === "full") {
        return value;
    }
    throw new Error(`${key} 必须是 off、stats、fragments 或 full。`);
}

function requireSharingMode(value: string | number | boolean | null, key: ConfigKey): SharingMode {
    if (value === "auto" || value === "ask") {
        return value;
    }
    throw new Error(`${key} 必须是 auto 或 ask。`);
}

async function checkFiles(inputs: string[], options: GlobalOptions): Promise<void> {
    const {config, configPath} = await loadConfig({cwd: process.cwd(), configPath: options.config});
    const loadedRules = await loadRules(config);
    const output = resolveOutput(config.output, options.format);
    const minLevel = resolveMinLevel(options.minLevel);
    const review = resolveReview(options.review);
    const scanAll = options.scanAll === true;

    const files = expandInputs(inputs);
    const results: FileResult[] = files.map((filePath) => {
        const content = readFileSync(filePath, "utf-8");
        const maskedRanges = resolveMaskedRanges(filePath, content, scanAll);
        const ctx = prepareScanContext(content, {maskedRanges, ignoreTerms: config.ignoreTerms});
        const allIssues = [...scanWithContext(ctx, loadedRules.regexRules), ...scanHandlerRules(ctx, loadedRules.handlerRules)];
        const allDensity = scanDensity(ctx, loadedRules.densityRules);
        // 两段过滤：先按审查受众，再按级别，各自独立统计隐藏数，互不重复计数。
        // density 命中走同样两段，隐藏数并进同一组计数。
        const afterReview = filterIssuesByReview(allIssues, review);
        const afterReviewDensity = review === "all" ? allDensity : allDensity.filter((issue) => issue.rule.review === review);
        const hiddenByReview = (allIssues.length - afterReview.length) + (allDensity.length - afterReviewDensity.length);
        const issues = filterIssuesByLevel(afterReview, minLevel);
        const densityIssues = afterReviewDensity.filter((issue) => LEVEL_RANK[issue.rule.level] >= LEVEL_RANK[minLevel]);
        const hiddenByLevel = (afterReview.length - issues.length) + (afterReviewDensity.length - densityIssues.length);
        return {filePath, summary: summarizeIssues(issues, countableVisibleChars(ctx, ctx.layers.all)), issues, densityIssues, hiddenByReview, hiddenByLevel};
    });

    const color = resolveColor(output);
    const printOptions: PrintOptions = {review, minLevel, showLines: options.showLines === true, ruleDetail: options.ruleDetail === true, color};
    if (results.length === 1) {
        printSingle(results[0]!, configPath, loadedRules, output, printOptions);
    } else {
        printMulti(results, configPath, loadedRules, output, printOptions);
    }
    // 退出码跟随可见视图：任一文件存在未被过滤掉的 high 命中（含密度指纹）即置 1。
    if (results.some((result) => hasHighLevelIssue(result.issues) || hasHighLevelDensity(result.densityIssues))) {
        process.exitCode = 1;
    }
}

/** density 命中里是否有 high 级别（与 hasHighLevelIssue 同口径）。 */
function hasHighLevelDensity(densityIssues: DensityIssue[] | undefined): boolean {
    return (densityIssues ?? []).some((issue) => issue.rule.level === "high");
}

type PrintOptions = {review: Review | "all"; minLevel: RuleLevel; showLines: boolean; ruleDetail: boolean; color: boolean};

/** 单文件输出：保持与历史一致的 JSON / stylish 形态。 */
function printSingle(result: FileResult, configPath: string | null, loadedRules: Awaited<ReturnType<typeof loadRules>>, output: LlmlintOutput, options: PrintOptions): void {
    const reportOptions = {
        review: options.review,
        hiddenByReview: result.hiddenByReview,
        minLevel: options.minLevel,
        hiddenByLevel: result.hiddenByLevel,
        color: options.color,
        densityIssues: result.densityIssues ?? [],
        ...(result.summary.visibleChars === undefined ? {} : {visibleChars: result.summary.visibleChars}),
        ...(options.showLines ? {showLines: true} : {}),
        ...(options.ruleDetail ? {ruleDetail: true} : {}),
    };
    console.log(output === "json"
        ? formatJsonReport(createCheckJsonReport(result.filePath, configPath, result.issues, loadedRules, reportOptions), options.ruleDetail)
        : formatCheckReport(result.filePath, result.issues, loadedRules, reportOptions));
}

/** 多文件输出：JSON 用 check-multi 形态；stylish 逐文件分段（诊断只在首段展示）+ 末尾聚合行。 */
function printMulti(results: FileResult[], configPath: string | null, loadedRules: Awaited<ReturnType<typeof loadRules>>, output: LlmlintOutput, options: PrintOptions): void {
    const filter: CheckFilterInfo = {
        review: options.review,
        hiddenByReview: results.reduce((sum, result) => sum + result.hiddenByReview, 0),
        minLevel: options.minLevel,
        hiddenByLevel: results.reduce((sum, result) => sum + result.hiddenByLevel, 0),
    };
    if (output === "json") {
        console.log(formatJsonReport(createMultiCheckJsonReport(configPath, results, loadedRules, filter, options.ruleDetail), options.ruleDetail));
        return;
    }
    const sections = results.map((result, index) => formatCheckReport(result.filePath, result.issues, loadedRules, {
        review: options.review,
        hiddenByReview: result.hiddenByReview,
        minLevel: options.minLevel,
        hiddenByLevel: result.hiddenByLevel,
        includeDiagnostics: index === 0,
        color: options.color,
        densityIssues: result.densityIssues ?? [],
        ...(result.summary.visibleChars === undefined ? {} : {visibleChars: result.summary.visibleChars}),
        ...(options.showLines ? {showLines: true} : {}),
    }));
    console.log([...sections, formatCheckAggregate(results, options.color)].join("\n\n"));
}

/** 展开输入：字面文件直接收，目录递归 .md/.markdown/.txt，glob 模式交给 tinyglobby。去重排序为绝对路径。 */
function expandInputs(inputs: string[]): string[] {
    const files = new Set<string>();
    const patterns: string[] = [];
    for (const input of inputs) {
        // 含 glob 元字符 → 当模式交给 tinyglobby（支持 **、! 排除、{a,b} 花括号）。
        if (/[*?{}[\]!]/.test(input)) {
            patterns.push(toPosix(input));
            continue;
        }
        const absolute = resolve(process.cwd(), input);
        if (!existsSync(absolute)) {
            throw new Error(`文件或目录不存在: ${input}`);
        }
        if (statSync(absolute).isDirectory()) {
            // 目录：以目录本身为 cwd 递归 glob，避免绝对路径 / 跨盘符模式在 tinyglobby 下不匹配。
            for (const match of globSync("**/*.{md,markdown,txt}", {cwd: absolute, absolute: true, onlyFiles: true})) {
                files.add(match);
            }
            continue;
        }
        files.add(absolute);
    }
    if (patterns.length > 0) {
        for (const match of globSync(patterns, {cwd: process.cwd(), absolute: true, onlyFiles: true, expandDirectories: false})) {
            files.add(match);
        }
    }
    if (files.size === 0) {
        throw new Error(`未匹配到任何可检查的文件: ${inputs.join(", ")}`);
    }
    return [...files].sort((left, right) => left.localeCompare(right));
}

/** Windows 反斜杠路径转 POSIX 正斜杠，供 glob 模式匹配使用。 */
function toPosix(path: string): string {
    return path.replace(/\\/g, "/");
}

/** 仅对 Markdown 文件计算遮罩区间；--scan-all 或非 Markdown 后缀时不遮罩。 */
function resolveMaskedRanges(filePath: string, content: string, scanAll: boolean): MaskedRange[] {
    if (scanAll || !/\.(md|markdown)$/i.test(filePath)) {
        return [];
    }
    return computeMaskedRanges(content);
}

async function fixFiles(inputs: string[], options: GlobalOptions): Promise<void> {
    const {config, configPath} = await loadConfig({cwd: process.cwd(), configPath: options.config});
    const loadedRules = await loadRules(config);
    const output = resolveOutput(config.output, options.format);
    const scanAll = options.scanAll === true;
    const write = options.write === true;
    // 只取「无需判断」的机械修复规则；candidate/manual 不在此自动改写。
    const autoRules = loadedRules.regexRules.filter((rule) => rule.fixability === "auto");

    const files = expandInputs(inputs);
    const results: FixFileResult[] = files.map((filePath) => {
        const content = readFileSync(filePath, "utf-8");
        const maskedRanges = resolveMaskedRanges(filePath, content, scanAll);
        const ctx = prepareScanContext(content, {maskedRanges, ignoreTerms: config.ignoreTerms});
        const issues = scanWithContext(ctx, autoRules);
        // 豁免词区间并进遮罩段：机械修复不得改写豁免词内部文本。
        const protectedRanges = mergeRanges([...maskedRanges, ...ctx.ignoreRanges]);
        const fixed = applyAutoFix(content, autoRules, protectedRanges);
        const changed = fixed !== content;
        if (write && changed) {
            writeFileSync(filePath, fixed, "utf-8");
        }
        return {filePath, content, fixed, changed, issues};
    });

    console.log(output === "json"
        ? formatJsonReport(createFixJsonReport(configPath, results, write))
        : formatFixReport(results, write, resolveColor(output)));
    // dry-run 且存在待修复项时置退出码 1（便于 CI 门禁，如「禁止零宽字符入库」）；--write 或无改动为 0。
    if (!write && results.some((result) => result.changed)) {
        process.exitCode = 1;
    }
}

async function showGuide(options: GlobalOptions): Promise<void> {
    const {config} = await loadConfig({cwd: process.cwd(), configPath: options.config});
    const loadedRules = await loadRules(config);
    const tier = resolveTier(options.tier);
    // 没传 --profile 就是没有判别力数据；此时 core 只剩语义规则、wide 等同 standard，
    // 刻意不猜一个内置报告路径——skill 包不依赖 evals（CONTEXT.md §2.4）。
    let verdicts: RuleVerdicts = new Map();
    if (options.profile !== undefined) {
        const profilePath = resolve(process.cwd(), options.profile);
        if (!existsSync(profilePath)) {
            throw new Error(`profile 报告不存在: ${options.profile}`);
        }
        try {
            verdicts = parseRuleVerdicts(readFileSync(profilePath, "utf-8"));
        } catch (error) {
            throw new Error(`profile 报告解析失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    // guide 只有 markdown 一种形态：产物本身就是要贴进提示词的散文，JSON 包装没有消费者。
    console.log(buildGuide(loadedRules, tier, verdicts));
}

async function showRules(options: GlobalOptions): Promise<void> {
    const {config, configPath} = await loadConfig({cwd: process.cwd(), configPath: options.config});
    const loadedRules = await loadRules(config);
    const output = resolveOutput(config.output, options.format);
    const detector = resolveDetectorKind(options.detector);
    const namespace = options.namespace ?? null;
    const filtered = filterRules(loadedRules.rules, detector, namespace);
    const filter = {detector, namespace};
    console.log(output === "json"
        ? formatJsonReport(createRulesJsonReport(configPath, loadedRules, filtered, filter))
        : formatRules(filtered, filter, loadedRules.summary, loadedRules.diagnostics, resolveColor(output)));
}

/**
 * 按判据类别与 namespace 过滤规则。
 *
 * namespace 先按内置 alias 归一（配置里支持中文 alias，过滤器保持一致），
 * 再做前缀匹配：传 `vocabulary` 同时命中 `vocabulary.body` 与 `vocabulary.r18`。
 */
function filterRules(rules: ActiveRuleRecord[], detector: RuleDetectorKind | "all", namespace: string | null): ActiveRuleRecord[] {
    const target = namespace === null ? null : DEFAULT_NAMESPACE_ALIASES[namespace] ?? namespace;
    return rules.filter((rule) => {
        if (detector !== "all" && ruleDetectorKind(rule) !== detector) {
            return false;
        }
        if (target !== null && rule.namespace !== target && !rule.namespace.startsWith(`${target}.`)) {
            return false;
        }
        return true;
    });
}

async function detectFiles(inputs: string[], options: GlobalOptions): Promise<void> {
    const settings = loadUserSettings();
    const detectorOptions = defaultDetectorOptions({
        space: settings.detector.space,
        chunkChars: settings.detector.chunkChars,
        minIntervalMs: settings.detector.minIntervalMs,
        proxy: settings.detector.proxy,
    });
    const output = resolveOutput("stylish", options.format);
    const files = expandInputs(inputs);
    const transport = new HfTransport(detectorOptions);
    const results: DetectFileResult[] = [];

    for (const filePath of files) {
        const content = readFileSync(filePath, "utf-8");
        const payload = await detectContent(filePath, content, detectorOptions, transport, options.noCache === true || options.cache === false);
        results.push(payload);
    }

    // stylish 分支自己按文件算派生字段（它还要用 result.content 取预览文本），这里不预先算一遍。
    if (output === "json") {
        console.log(JSON.stringify({kind: "detect" as const, files: results.map(toDetectReport)}, null, 2));
        return;
    }
    console.log(formatDetectReport(results));
}

async function detectContent(filePath: string, content: string, detectorOptions: ReturnType<typeof defaultDetectorOptions>, transport: DetectorTransport, noCache: boolean): Promise<DetectFileResult> {
    const key = detectCacheKey(content, detectorOptions);
    if (!noCache) {
        const cached = readDetectCache(key);
        if (cached) {
            return {...cached, filePath, cached: true, content};
        }
    }

    const chunks = chunkBySentence(content, detectorOptions.chunkChars);
    if (chunks.length === 0) {
        const emptyPayload: DetectPayload = {
            detector: {
                version: detectorOptions.version,
                endpoint: detectorOptions.endpoint,
                space: detectorOptions.space,
                chunkChars: detectorOptions.chunkChars,
            },
            docPAi: 0,
            maxPAi: 0,
            chunks: [],
        };
        writeDetectCache(key, emptyPayload);
        return {...emptyPayload, filePath, cached: false, content};
    }

    const scores = await transport.detectChunks(chunks.map((chunk) => chunk.text));
    const aggregateScore = aggregate(scores, chunks);
    const lineStarts = buildLineStarts(content);
    const payload: DetectPayload = {
        detector: {
            version: detectorOptions.version,
            endpoint: detectorOptions.endpoint,
            space: detectorOptions.space,
            chunkChars: detectorOptions.chunkChars,
        },
        docPAi: aggregateScore.docPAi,
        maxPAi: aggregateScore.maxPAi,
        chunks: chunks.map((chunk, index) => ({
            span: [chunk.start, chunk.end],
            pAi: scores[index] ?? 0,
            line: locatePosition(content, lineStarts, chunk.start).line,
        })),
    };
    writeDetectCache(key, payload);
    return {...payload, filePath, cached: false, content};
}

/**
 * 文内最可疑 / 最不可疑各取的 chunk 数：`ceil(总数 / 4)`，至少 1。
 * 绝对阈值（如 P(AI) ≥ 0.85）在整体 AI 文本上会把全文标红，四象限失去分辨力；相对排序不会。
 */
function edgeChunkCount(total: number): number {
    return Math.max(1, Math.ceil(total / 4));
}

/** 文内 P(AI) 极差；chunk 少于 2 个时无极差可言，返回 0。 */
function chunkSpread(chunks: DetectPayload["chunks"]): number {
    if (chunks.length < 2) {
        return 0;
    }
    const scores = chunks.map((chunk) => chunk.pAi);
    return Math.max(...scores) - Math.min(...scores);
}

/** preview 最大码点数：足够判断 chunk 主题，又控制 JSON 体积。 */
const DETECT_PREVIEW_CHARS = 48;

/** 取 chunk 开头可见字符作 preview：折叠空白，按码点裁剪，避免切断代理对。 */
function chunkPreview(content: string, chunk: {span: [number, number]}): string {
    const raw = content.slice(chunk.span[0], Math.min(content.length, chunk.span[0] + DETECT_PREVIEW_CHARS * 2));
    const compact = raw.replace(/\s+/gu, " ");
    return Array.from(compact).slice(0, DETECT_PREVIEW_CHARS).join("");
}

function toDetectReport(result: DetectFileResult): DetectFileReport {
    // 派生字段（rank / relative / spread）在报告层算，刻意不写进缓存 payload：
    // 否则每次给报告加字段都要让全部 content-hash 缓存失效。
    const descending = [...result.chunks].sort((left, right) => right.pAi - left.pAi);
    const rankByChunk = new Map(descending.map((chunk, index) => [chunk, index + 1]));
    return {
        filePath: result.filePath,
        docPAi: result.docPAi,
        maxPAi: result.maxPAi,
        spread: chunkSpread(result.chunks),
        cached: result.cached,
        // chunks 保持原文顺序，位次单独用 rank 表达。
        chunks: result.chunks.map((chunk) => ({
            ...chunk,
            rank: rankByChunk.get(chunk) ?? 1,
            relative: chunk.pAi - result.docPAi,
            preview: chunkPreview(result.content, chunk),
        })),
    };
}

function formatDetectReport(results: DetectFileResult[]): string {
    const lines: string[] = [];
    for (const result of results) {
        const report = toDetectReport(result);
        lines.push(`${result.filePath}`);
        // 整篇层用绝对判据回答「这篇整体可疑吗」。
        const docVerdict = report.docPAi >= DETECT_DOC_SUSPICIOUS ? "整体可疑" : "整体不可疑";
        lines.push(`  mean P(AI): ${formatProbability(report.docPAi)}（${docVerdict}）；max P(AI): ${formatProbability(report.maxPAi)}；文内极差: ${formatProbability(report.spread)}；cached: ${report.cached}`);
        if (report.chunks.length === 0) {
            lines.push("  文内分布：无可检测内容");
            lines.push("");
            continue;
        }
        if (report.spread < DETECT_SPREAD_FLOOR) {
            // 全篇均匀：热区/冷区之分是噪声，明确告诉消费者四象限在这篇不适用。
            lines.push(`  文内分布：极差 < ${DETECT_SPREAD_FLOOR}，全篇均匀，四象限不适用；按规则信号密度排优先级。`);
            lines.push("");
            continue;
        }

        if (report.spread < DETECT_SPREAD_FLOOR + DETECT_SPREAD_MARGIN) {
            // 刚过线：仍给两端，但明说位次是弱证据，免得消费者把「勉强过线」当「分层明显」。
            lines.push(`  文内分布：极差 ${formatProbability(report.spread)} 贴近 ${DETECT_SPREAD_FLOOR} 门槛，位次是弱证据；两种读法都要说明，以规则信号密度为主。`);
        }
        const count = edgeChunkCount(report.chunks.length);
        const byScore = [...report.chunks].sort((left, right) => left.rank - right.rank);
        // 刻意不用「热区 / 冷区」：文内低位不等于检测器认为它像人写（本篇 rank 6 仍有 P(AI)=0.929），
        // 绝对判断只在 mean P(AI) 那一层做。红绿措辞会诱导「低位 ⇒ 规则误报」的错误推论。
        lines.push(`  文内最可疑（rank 1–${count} / ${report.chunks.length}）：`);
        for (const chunk of byScore.slice(0, count)) {
            lines.push(`    ${formatDetectChunk(result, chunk)}`);
        }
        // chunk 数不足 2×count 时两端会重叠，此时不单列低位段。
        if (report.chunks.length >= count * 2) {
            lines.push(`  文内最不可疑（rank ${report.chunks.length - count + 1}–${report.chunks.length}，仍需看绝对 P(AI)）：`);
            for (const chunk of byScore.slice(-count)) {
                lines.push(`    ${formatDetectChunk(result, chunk)}`);
            }
        }
        lines.push("");
    }
    return lines.join("\n").trimEnd();
}

/** 单个 chunk 的一行呈现：行号范围、P(AI)、文内位次、相对文档均值偏离、短预览。 */
function formatDetectChunk(result: DetectFileResult, chunk: DetectChunkReport): string {
    const delta = `${chunk.relative >= 0 ? "+" : "-"}${formatProbability(Math.abs(chunk.relative))}`;
    return `L${chunk.line}-${detectEndLine(result, chunk.span[1])}  P(AI)=${formatProbability(chunk.pAi)}  rank ${chunk.rank}  Δ${delta}  ${previewChunk(result, chunk.span)}`;
}

function detectEndLine(result: DetectFileResult, end: number): number {
    if (end <= 0) {
        return 1;
    }
    return locatePosition(result.content, buildLineStarts(result.content), end - 1).line;
}

function previewChunk(result: DetectFileResult, span: [number, number]): string {
    const preview = result.content.slice(span[0], span[1]).replace(/\s+/gu, " ").trim();
    return Array.from(preview).slice(0, 30).join("");
}

function formatProbability(value: number): string {
    return value.toFixed(3);
}

function mergeOptions(program: Command, commandOptions: GlobalOptions | Command): GlobalOptions {
    const localOptions = typeof (commandOptions as Command).opts === "function"
        ? (commandOptions as Command).opts<GlobalOptions>()
        : commandOptions as GlobalOptions;
    return {
        ...program.opts<GlobalOptions>(),
        ...localOptions,
    };
}

function resolveOutput(configOutput: LlmlintOutput, optionOutput: string | undefined): LlmlintOutput {
    if (!optionOutput) {
        return configOutput;
    }
    if (!OUTPUTS.has(optionOutput as LlmlintOutput)) {
        throw new Error(`输出格式无效: ${optionOutput}`);
    }
    return optionOutput as LlmlintOutput;
}

function resolveMinLevel(minLevel: string | undefined): RuleLevel {
    if (!minLevel) {
        return "low";
    }
    if (!LEVELS.has(minLevel as RuleLevel)) {
        throw new Error(`级别过滤无效: ${minLevel}`);
    }
    return minLevel as RuleLevel;
}

/** guide 档位；默认 standard——core 只有十余条推不动效果，full 含全部词表要显式要求。 */
function resolveTier(tier: string | undefined): GuideTier {
    if (!tier) {
        return "standard";
    }
    if (!GUIDE_TIERS.includes(tier as GuideTier)) {
        throw new Error(`档位无效: ${tier}。合法值：${GUIDE_TIERS.join("、")}`);
    }
    return tier as GuideTier;
}

/** rules 的判据类别过滤；缺省 all。 */
function resolveDetectorKind(detector: string | undefined): RuleDetectorKind | "all" {
    if (!detector || detector === "all") {
        return "all";
    }
    if (!DETECTOR_KINDS.has(detector as RuleDetectorKind)) {
        throw new Error(`判据类别无效: ${detector}。合法值：${[...DETECTOR_KINDS].join("、")}`);
    }
    return detector as RuleDetectorKind;
}

/** 审查受众过滤；默认 agent，即只展示需要 Agent/LLM 处理的命中。 */
function resolveReview(review: string | undefined): Review | "all" {
    if (!review) {
        return "agent";
    }
    if (!REVIEWS.has(review as Review | "all")) {
        throw new Error(`审查受众过滤无效: ${review}`);
    }
    return review as Review | "all";
}

/** stylish 是否着色：仅当输出非 json、stdout 是 TTY、且未设 NO_COLOR；Agent/管道下自动纯文本。 */
function resolveColor(output: LlmlintOutput): boolean {
    return output !== "json" && process.stdout.isTTY === true && !process.env.NO_COLOR;
}

function filterIssuesByLevel(issues: Issue[], minLevel: RuleLevel): Issue[] {
    return issues.filter((issue) => LEVEL_RANK[issue.rule.level] >= LEVEL_RANK[minLevel]);
}

function filterIssuesByReview(issues: Issue[], review: Review | "all"): Issue[] {
    if (review === "all") {
        return issues;
    }
    return issues.filter((issue) => issue.rule.review === review);
}
