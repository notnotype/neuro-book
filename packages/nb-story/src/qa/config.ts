/**
 * 问答与抽取共用的配置文件（docs/specs/story/qa.md 的“配置”、docs/specs/story/ingest.md 的“抽取模型”）。密钥本身
 * 不在这里，只写存密钥的环境变量名。
 *
 * 这里不导入 nb-harness：它一被导入，OMP 就接管中断信号（`nbstory ingest` 要自己处理 Ctrl-C）。配置到 nb-harness
 * 模型的转换在 harness-model.ts。
 */

import {createHash, randomBytes} from "node:crypto";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {basename, dirname, join} from "node:path";

import type {Static} from "typebox";
import {Compile} from "typebox/compile";

import {tryLock} from "@notnotype/nb-flock";

import {ConfigSchema, LegacyModelSchema, PROVIDER_ID_PATTERN, type IngestModelSchema, type PriceSchema, type ProviderConfig, type QaConfig} from "../contract/config-schema";
import {QaError} from "./errors";

export type {CustomModelConfig, Effort, ProviderApi, ProviderConfig, QaConfig} from "../contract/config-schema";

/** 图当目录一问最多读的不同章数（开发者定的上限，配置只能调小）。 */
export const MAX_CHAPTERS = 20;
export const DEFAULT_FULL_READ_MAX_CHARS = 300_000;

const checkConfig = Compile(ConfigSchema);
const checkLegacyModel = Compile(LegacyModelSchema);

const PROVIDER_ID = new RegExp(PROVIDER_ID_PATTERN, "u");

/** 第 1 版配置升级后，那个唯一的模型所在的自定义服务商。 */
export const LEGACY_PROVIDER_ID = "custom";

/** 配置文件的默认位置：`$XDG_CONFIG_HOME/nbstory/config.json`，未设置时 `~/.config/nbstory/config.json`。 */
export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
    return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "nbstory", "config.json");
}

/**
 * 第 1 版（`model` 是 `{baseUrl, id, apiKeyEnv, …}`）在内存里升级成第 2 版：建自定义服务商 `custom`，候选与默认都是
 * `custom/<id>`，接口、推理档、上下文、最大输出与单价跟过去。认不出第 1 版的原样返回，交给 schema 报错。纯函数，
 * 命令行、服务端与设置页共用；写回一律写第 2 版。
 */
export function upgradeQaConfig(value: unknown): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    const {model, ...rest} = value as {model?: unknown};
    if (!checkLegacyModel.Check(model)) return value;
    const {baseUrl, id, apiKeyEnv, api, contextWindow, maxTokens, thinking, price} = model;
    const provider: ProviderConfig = {
        api: api === "responses" ? "openai-responses" : "openai-completions",
        baseUrl,
        apiKeyEnv,
        models: [
            {
                id,
                ...(contextWindow === undefined ? {} : {contextWindow}),
                ...(maxTokens === undefined ? {} : {maxTokens}),
                // 第 1 版写了推理档就按推理模型发（harness-model.ts 当时的做法），升级后照旧。
                ...(thinking === undefined ? {} : {reasoning: true}),
                ...(price === undefined ? {} : {price}),
            },
        ],
    };
    const ref = `${LEGACY_PROVIDER_ID}/${id}`;
    return {...rest, providers: {[LEGACY_PROVIDER_ID]: provider}, models: [ref], model: {use: ref, ...(thinking === undefined ? {} : {thinking})}};
}

/**
 * 升级后按配置的 schema 校验形状；不对时报 `qa_unconfigured`，写明是哪个字段（最多三处）。`source` 说明这份配置从哪来。
 * 字段之间的约束（候选、默认、服务商）在 `configProblems`。
 */
export function parseQaConfig(value: unknown, source: string): QaConfig {
    const upgraded = upgradeQaConfig(value);
    if (!checkConfig.Check(upgraded)) {
        const problems = [...checkConfig.Errors(upgraded)].slice(0, 3).map(item => `${item.instancePath || "/"} ${item.message}`);
        throw new QaError("qa_unconfigured", `问答配置${source}不对：${problems.join("；")}`);
    }
    return upgraded;
}

/** 模型引用 `服务商/模型名`：第一个 `/` 之前是服务商（模型名里可以再有 `/`）。 */
export function parseModelRef(ref: string): {provider: string; model: string} {
    const slash = ref.indexOf("/");
    return slash <= 0 ? {provider: "", model: ref} : {provider: ref.slice(0, slash), model: ref.slice(slash + 1)};
}

/**
 * OMP 目录的查表，由已经加载了 nb-harness 的调用方给（见 harness-model.ts 的 `configCatalog`）。这里不导入它：
 * `pi-catalog` 一被导入就接管中断信号，`nbstory ingest` 要自己处理 Ctrl-C。不给时只查自定义服务商这一侧。
 */
export interface ConfigCatalog {
    hasProvider(id: string): boolean;
    hasModel(provider: string, model: string): boolean;
}

/** 字段之间的约束不成立之处（qa.md 的“配置”），全成立时为空。 */
export function configProblems(config: QaConfig, catalog: ConfigCatalog | null): string[] {
    const problems: string[] = [];
    const providers = config.providers ?? {};
    for (const [id, provider] of Object.entries(providers)) {
        if (!PROVIDER_ID.test(id)) problems.push(`自定义服务商的 id ${JSON.stringify(id)} 只能有小写字母、数字与连字符`);
        if (catalog?.hasProvider(id)) problems.push(`自定义服务商 ${id} 与 OMP 目录里的服务商重名，换个 id`);
        const seen = new Set<string>();
        for (const model of provider.models) {
            if (seen.has(model.id)) problems.push(`自定义服务商 ${id} 里模型 ${model.id} 写了两次`);
            seen.add(model.id);
        }
    }
    if (config.models.length === 0) problems.push("候选模型（models）至少要有一个");
    const candidates = new Set<string>();
    for (const ref of config.models) {
        if (candidates.has(ref)) problems.push(`候选模型 ${ref} 写了两次`);
        candidates.add(ref);
        const problem = refProblem(config, ref, catalog);
        if (problem !== null) problems.push(problem);
    }
    if (config.models.length > 0 && !candidates.has(config.model.use)) problems.push(`默认模型 ${config.model.use} 不在候选模型里`);
    return problems;
}

/** 一个引用指向的模型不存在时的说明。目录那一侧没给 `catalog` 时不查。 */
export function refProblem(config: QaConfig, ref: string, catalog: ConfigCatalog | null): string | null {
    const {provider, model} = parseModelRef(ref);
    const custom = config.providers?.[provider];
    if (custom !== undefined) return custom.models.some(item => item.id === model) ? null : `候选模型 ${ref}：自定义服务商 ${provider} 里没有模型 ${model}`;
    if (catalog === null) return null;
    if (!catalog.hasProvider(provider)) return `候选模型 ${ref}：没有服务商 ${provider}（既不是自定义服务商，也不在 OMP 目录里）`;
    return catalog.hasModel(provider, model) ? null : `候选模型 ${ref}：OMP 目录的 ${provider} 里没有模型 ${model}`;
}

/** 形状与字段之间的约束都校验；不对时报 `qa_unconfigured`。所有读写配置的入口共用（见 qa.md 的“配置”）。 */
export function validateQaConfig(value: unknown, source: string, catalog: ConfigCatalog | null): QaConfig {
    const config = parseQaConfig(value, source);
    const problems = configProblems(config, catalog);
    if (problems.length > 0) throw new QaError("qa_unconfigured", `问答配置${source}不对：${problems.slice(0, 3).join("；")}`);
    return config;
}

/** 配置文件内容的摘要：写入时比对用（`config.set` 的 `expect`）。文件不在时是 `absent`。 */
export type ConfigDigest = string;
export const ABSENT_CONFIG: ConfigDigest = "absent";

/** 摘要按文件原字节算（解码后再算，坏的 UTF-8 会被替换成同一个字符，不同的文件得到同一个摘要）。 */
const digestOf = (bytes: Uint8Array | string): ConfigDigest => createHash("sha256").update(bytes).digest("hex");

/** 文件不在时为 null；别的读不出（是目录、没权限、读错）报 `qa_unconfigured`，不当作“没有文件”。 */
async function readConfigBytes(path: string): Promise<Buffer | null> {
    try {
        return await readFile(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new QaError("qa_unconfigured", `读不出问答配置 ${path}（${(error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.message : String(error))}）`, {cause: error});
    }
}

function parseConfigText(path: string, text: string): unknown {
    try {
        return JSON.parse(text) as unknown;
    } catch (error) {
        throw new QaError("qa_unconfigured", `问答配置 ${path} 不是 JSON`, {cause: error});
    }
}

async function readConfigValue(path: string): Promise<{value: unknown; digest: ConfigDigest}> {
    const bytes = await readConfigBytes(path);
    if (bytes === null) throw new QaError("qa_unconfigured", `读不到问答配置 ${path}：先用 nbstory config init 写好它（字段见 docs/specs/story/qa.md 的“配置”）`);
    return {value: parseConfigText(path, bytes.toString("utf8")), digest: digestOf(bytes)};
}

/** 读并校验配置；文件不在、不是 JSON 或字段不对都报 `qa_unconfigured`，写明是哪个字段。第 1 版读出来是升级后的第 2 版。 */
export async function loadQaConfig(path: string = defaultConfigPath(), catalog: ConfigCatalog | null = null): Promise<QaConfig> {
    return (await readQaConfigFile(path, catalog)).config;
}

/** 读配置连同它此刻的摘要（之后改写时带上，见 `saveQaConfig` 的 `expect`）。 */
export async function readQaConfigFile(path: string = defaultConfigPath(), catalog: ConfigCatalog | null = null): Promise<{config: QaConfig; digest: ConfigDigest}> {
    const {value, digest} = await readConfigValue(path);
    return {config: validateQaConfig(value, ` ${path} `, catalog), digest};
}

/** 只校验形状地读：字段之间的约束不成立的配置也读得出来，供 `config set` 修好它；写回时照样全校验。 */
export async function readQaConfigShape(path: string): Promise<{config: QaConfig; digest: ConfigDigest}> {
    const {value, digest} = await readConfigValue(path);
    return {config: parseQaConfig(value, ` ${path} `), digest};
}

/**
 * 配置文件此刻的摘要，内容不合格也给（网页在配置坏了时也要能整份改写）；文件不在是 `absent`。文件读不出来时报
 * `qa_unconfigured`：不知道里面是什么，不能当作没有文件、让 `absent` 的写入盖掉它。
 */
export async function currentConfigDigest(path: string): Promise<ConfigDigest> {
    const bytes = await readConfigBytes(path);
    return bytes === null ? ABSENT_CONFIG : digestOf(bytes);
}

/** 准备改写配置时读它此刻的摘要：读不出来（路径上是文件、没权限）就是写不了，报 `qa_config_write_failed`。 */
export async function digestBeforeWrite(path: string): Promise<ConfigDigest> {
    try {
        return await currentConfigDigest(path);
    } catch (error) {
        throw new QaError("qa_config_write_failed", `写不了问答配置 ${path}：${error instanceof Error ? error.message : String(error)}`, {cause: error});
    }
}

/** 等别的程序写完配置最多这么久；写一次配置是毫秒级的，等满了多半是有进程卡在写的中途。 */
const LOCK_WAIT_MS = 5_000;
const LOCK_RETRY_MS = 50;

/**
 * 程序对配置的写入（命令行的 init、set、unset，网页的设置页）都在这把跨进程锁里做：锁内重读、比对、校验、写临时
 * 文件、改名，几个写入不会交错，比对与发布之间也不会插进别人的写入。锁是同目录的 `.lock` 文件上的 flock，持有的进程
 * 退出（含崩溃）时系统自动放掉。手改文件不走锁，只能靠摘要尽力发现。
 */
async function withConfigLock<T>(path: string, run: () => Promise<T>): Promise<T> {
    try {
        await mkdir(dirname(path), {recursive: true});
    } catch (error) {
        throw new QaError("qa_config_write_failed", `写不了问答配置 ${path}：${error instanceof Error ? error.message : String(error)}`, {cause: error});
    }
    // 锁文件与配置同目录、以点开头：它常驻（删掉正被别人锁着的文件会让两个进程各锁一份），不是临时文件。
    const lockPath = join(dirname(path), `.${basename(path)}.lock`);
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
        let lock: ReturnType<typeof tryLock>;
        try {
            lock = tryLock(lockPath);
        } catch (error) {
            throw new QaError("qa_config_write_failed", `写不了问答配置 ${path}：${error instanceof Error ? error.message : String(error)}`, {cause: error});
        }
        if (lock !== null) {
            try {
                return await run();
            } finally {
                lock.release();
            }
        }
        if (Date.now() >= deadline) throw new QaError("qa_config_write_failed", `写不了问答配置 ${path}：另一个程序正在写它，等了 ${LOCK_WAIT_MS / 1000} 秒还没写完`);
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_MS));
    }
}

/**
 * 校验后写盘，返回写下的配置与它的摘要。先写同目录的临时文件（每次随机命名：服务进程里几个请求可能同时写）再改名，
 * 读者（正在跑的 `ask`）要么读到旧的整份，要么读到新的整份；校验不过或写失败时原文件不动。给了 `expect` 时，锁内重读
 * 的摘要与它不同就报 `config_conflict`（别处改过了）。密钥不在配置里（只有环境变量名），所以文件用普通权限。
 */
export async function saveQaConfig(path: string, config: unknown, options: {expect?: ConfigDigest; catalog?: ConfigCatalog | null} = {}): Promise<{config: QaConfig; digest: ConfigDigest}> {
    // 校验只看内容、不看文件，放在锁外与锁内等价。
    const valid = validateQaConfig(config, ` ${path} `, options.catalog ?? null);
    return withConfigLock(path, async () => {
        if (options.expect !== undefined) {
            const current = await digestBeforeWrite(path);
            if (current !== options.expect) throw new QaError("config_conflict", `问答配置 ${path} 在你读取之后被别处改过了：重新读取再改`);
        }
        const text = `${JSON.stringify(valid, null, 4)}\n`;
        const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
        const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));
        const failed = (error: unknown, note = ""): QaError => new QaError("qa_config_write_failed", `写不了问答配置 ${path}：${reason(error)}${note}`, {cause: error});
        let created = false;
        try {
            await writeFile(temporary, text);
            created = true;
            await rename(temporary, path);
        } catch (error) {
            // 原文件没动过。临时文件写出来了就清理；清理也失败时照样报写失败，不让清理的错误盖掉它，留下的临时文件写进说明。
            const leftover = created ? await rm(temporary, {force: true}).then(() => null, (cleanup: unknown) => cleanup) : null;
            throw failed(error, leftover === null ? "" : `；临时文件 ${temporary} 没能删掉：${reason(leftover)}`);
        }
        return {config: valid, digest: digestOf(text)};
    });
}

export function qaLimits(config: QaConfig): {maxChapters: number; fullReadMaxChars: number} {
    return {maxChapters: config.qa?.maxChapters ?? MAX_CHAPTERS, fullReadMaxChars: config.qa?.fullReadMaxChars ?? DEFAULT_FULL_READ_MAX_CHARS};
}

/** 抽取一次请求的输出上限，配置里没写 `maxTokens` 时用（与抽取管线定型时相同）。 */
export const DEFAULT_INGEST_MAX_TOKENS = 32_000;

export interface IngestModel {
    baseUrl: string;
    id: string;
    apiKeyEnv: string;
    maxTokens: number;
    price: Static<typeof PriceSchema> | null;
    /** 取自哪一节：`ingest.model`，或没有它时问答的默认模型。 */
    source: "ingest.model" | "model";
}

/** 挑选相关说法用的模型；多一种来源 `ingest.recall.model`。 */
export type RecallModel = Omit<IngestModel, "source"> & {source: IngestModel["source"] | "ingest.recall.model"};

/**
 * 抽取用的模型：`ingest.model`；没有时用问答的默认模型（其中的推理档不用）。抽取管线只会 OpenAI Chat 协议，所以
 * 回落只在默认模型是 `openai-completions` 接口的自定义服务商时成立；目录模型与别的接口报 `qa_unconfigured` 并写明
 * 原因（目录模型的地址与密钥要加载 OMP 才知道，抽取不加载它）。
 */
export function ingestModel(config: QaConfig): IngestModel {
    const own = config.ingest?.model;
    if (own) return {...asModel(own), source: "ingest.model"};
    const fallback = defaultIngestFallback(config);
    if (typeof fallback === "string") throw new QaError("qa_unconfigured", fallback);
    return {...fallback, source: "model"};
}

/**
 * 问答默认模型能不能给抽取用：能时是抽取的模型，不能时是原因。设置页与 `config show` 用它说明抽取用什么。
 */
export function defaultIngestFallback(config: QaConfig): Omit<IngestModel, "source"> | string {
    const ref = config.model.use;
    const {provider: providerId, model: modelId} = parseModelRef(ref);
    const provider = config.providers?.[providerId];
    if (provider === undefined) return `抽取要单独写模型（ingest.model）：问答默认模型 ${ref} 是 OMP 目录里的模型，抽取只用自定义服务商的 OpenAI Chat 接口`;
    if (provider.api !== "openai-completions") return `抽取要单独写模型（ingest.model）：问答默认模型 ${ref} 用的接口是 ${provider.api}，抽取只会 OpenAI Chat 接口（openai-completions）`;
    const model = provider.models.find(item => item.id === modelId);
    return {baseUrl: provider.baseUrl, id: modelId, apiKeyEnv: provider.apiKeyEnv, maxTokens: model?.maxTokens ?? DEFAULT_INGEST_MAX_TOKENS, price: model?.price ?? null};
}

/** 马甲核对（docs/specs/story/ingest.md 输出 20）开不开：默认开，只有写明 `ingest.personaCheck.enabled: false` 才关。 */
export function personaCheckEnabled(config: QaConfig): boolean {
    return config.ingest?.personaCheck?.enabled !== false;
}

/** 挑选相关说法用的模型；没开（默认）时为 null。整节继承：`ingest.recall.model`，没有时用抽取的模型。 */
export function recallModel(config: QaConfig): RecallModel | null {
    const recall = config.ingest?.recall;
    if (recall?.enabled !== true) return null;
    return recall.model ? {...asModel(recall.model), source: "ingest.recall.model"} : ingestModel(config);
}

function asModel(model: Static<typeof IngestModelSchema>): Omit<IngestModel, "source"> {
    return {baseUrl: model.baseUrl, id: model.id, apiKeyEnv: model.apiKeyEnv, maxTokens: model.maxTokens ?? DEFAULT_INGEST_MAX_TOKENS, price: model.price ?? null};
}
