// eval 配置加载：evals/eval.config.json（真实配置，gitignore，可含密钥）> eval.config.example.json（进 git 的模板）> 内置默认。
// 密钥纪律：example 里绝不放真实 key；CLI provider 的 env 真值只写在 gitignored 的 eval.config.json。
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";

/** CLI transport 的 provider（claude -p / codex exec 这类本地命令行模型通道）。 */
export type CliProviderConfig = {
    transport: "cli";
    /** 命令模板（数组参数，不拼 shell 字符串）；{MODEL} 占位符 = model id；prompt 一律走 stdin */
    command: string[];
    /** 注入子进程的环境变量（如 ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN）；真值只放 gitignored 配置 */
    env?: Record<string, string>;
    /** 该通道可用的 model id 列表（文档性质，不强校验） */
    models?: string[];
    /** 单次调用墙钟上限（CLI 启动慢，默认比 HTTP 宽） */
    timeoutMs?: number;
    /** 输出解析：claude-json=claude -p --output-format json；codex-json=codex --json JSONL；text=stdout 原文 */
    output?: "text" | "claude-json" | "codex-json";
};

export type RetryConfig = {maxAttempts: number; backoffBaseMs: number};
export type RateLimitRule = {concurrency: number; minIntervalMs: number};
export type DetectorConfig = {
    kind: string;
    /** gradio api_name（如 predict_zh） */
    endpoint: string;
    /** 分块目标字数（检测器只读前部窗口，见 task08 实测） */
    chunkChars: number;
    /** 相邻请求最小间隔（免费实例限速） */
    minIntervalMs: number;
    /** 版本标（space 不自报版本，用固定日期/revision；跨版本概率不可比） */
    version: string;
};

/** LLM 文本分类器（题材/体裁/视角补空；classifier/classify-agent.ts）。 */
export type ClassifierConfig = {
    /** 分类模型 modelKey（须 HTTP 通道——CLI 无工具协议） */
    model: string;
    /** 送入模型的正文上限字符数（分类不需要全文） */
    maxChars: number;
};

/**
 * repair（采集线 A 一轮修复，generator/repair.ts）：render → llmlint 命中摘要 → LLM 润色出 repair 样本。
 * 何时可空：整个节点可空——未配置且 CLI 未传 --repair-model 时 repair.ts 直接报错退出，其它 CLI 不受影响；
 * promptVersion 可空 = 用 generator/prompts.ts 的默认 repair 版本（版本 key 必须已在注册表登记，I8）。
 */
export type RepairConfig = {
    /** 修复模型 modelKey（provider/model；推荐稳定的 HTTP 模型） */
    model: string;
    /** repair prompt 版本 key（如 repair-v1）；空 = 默认版本 */
    promptVersion?: string;
};

export type EvalConfig = {
    /** LLM HTTP provider 真相源（NeuroBook config.json）路径；相对 llmlint 仓根 */
    modelsConfig: string;
    /** 所有 provider（HTTP + CLI）走的 http proxy（如 http://127.0.0.1:<端口>）；空=直连。部分 CLI provider 必须走代理 */
    proxy?: string;
    /** per-provider 单次调用墙钟超时覆盖（providerId → ms）；给推理模型（doubao 长章）加长。上限受 model-client HARD_TIMEOUT_CAP_MS(600s) */
    providerTimeouts?: Record<string, number>;
    /** reference 数据集根（catalog.json/manifest.tsv 所在）；跨仓绝对路径 */
    datasetsRoot?: string;
    /** render 模型面板（modelKey = provider/model，可混 HTTP 与 CLI provider） */
    renderModels: string[];
    /** brief 抽取器 modelKey（用 HTTP 模型：CLI 慢、贵） */
    extractor: string;
    /** prompt 版本选择（I8：版本 key 见 generator/prompts.ts） */
    prompts: {brief: string; render: string};
    retry: RetryConfig;
    rateLimit: {default: RateLimitRule; perProvider?: Record<string, RateLimitRule>};
    /** CLI transport providers（key = providerId，modelKey 写 `<providerId>/<modelId>`） */
    cliProviders?: Record<string, CliProviderConfig>;
    detector?: DetectorConfig;
    /** LLM 文本分类器（可选；未配则 classify CLI 需显式 --model） */
    classifier?: ClassifierConfig;
    /** repair 一轮修复（可选；未配则 repair CLI 需显式 --repair-model） */
    repair?: RepairConfig;
};

const CONFIG_PATH = join(import.meta.dir, "..", "eval.config.json");
const EXAMPLE_PATH = join(import.meta.dir, "..", "eval.config.example.json");

const BUILTIN_DEFAULTS: EvalConfig = {
    modelsConfig: "workspace/.nbook/config.json",
    renderModels: ["deepseek/deepseek-v4-flash", "xiaomi-token-plan-cn/mimo-v2.5-pro", "doubao/doubao-seed-2-1-pro-260628"],
    extractor: "xiaomi-token-plan-cn/mimo-v2.5-pro",
    prompts: {brief: "brief-v2", render: "render-v1"},
    retry: {maxAttempts: 3, backoffBaseMs: 1000},
    rateLimit: {default: {concurrency: 1, minIntervalMs: 0}},
};

/**
 * 加载 eval 配置：eval.config.json > eval.config.example.json > 内置默认（浅合并，嵌套对象整体覆盖）。
 * @param explicitPath 显式配置路径（CLI --eval-config），跳过默认查找
 */
export function loadEvalConfig(explicitPath?: string): EvalConfig {
    const path = explicitPath ?? (existsSync(CONFIG_PATH) ? CONFIG_PATH : existsSync(EXAMPLE_PATH) ? EXAMPLE_PATH : undefined);
    if (!path) {
        return BUILTIN_DEFAULTS;
    }
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<EvalConfig>;
    return {
        ...BUILTIN_DEFAULTS,
        ...raw,
        prompts: {...BUILTIN_DEFAULTS.prompts, ...raw.prompts},
        retry: {...BUILTIN_DEFAULTS.retry, ...raw.retry},
        rateLimit: {default: raw.rateLimit?.default ?? BUILTIN_DEFAULTS.rateLimit.default, perProvider: raw.rateLimit?.perProvider},
    };
}
