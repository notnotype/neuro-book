/**
 * `nbstory config set/unset` 的字段表与改法（docs/specs/story/qa.md 的“配置”）。只认配置 schema 里的字段；改完整份
 * 配置重新过 schema 与语义校验（`configProblems`），所以字段之间的约束只在那两处。
 */

import {EFFORTS, ENV_NAME_PATTERN, PROVIDER_APIS, PROVIDER_ID_PATTERN} from "../contract/config-schema";
import {configProblems, LEGACY_PROVIDER_ID, parseQaConfig, type ConfigCatalog, type Effort, type ProviderConfig, type QaConfig} from "./config";

/** 字段名不认识、值的写法不对，或要去掉必填字段：用法错误，不是配置错误。 */
export class ConfigEditError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ConfigEditError";
    }
}

type Kind = "text" | "envName" | "integer" | "boolean" | "choice" | "json";

interface FieldSpec {
    kind: Kind;
    /** 必填字段只能改，不能去掉。 */
    required: boolean;
    /** `choice` 字段能写的值（与配置 schema 的枚举一致）。 */
    choices?: readonly string[];
    /** JSON 字段的写法示例。 */
    example?: string;
}

const PRICE_EXAMPLE = `'{"input":1,"output":4,"currency":"USD"}'`;
const INGEST_MODEL_EXAMPLE = `'{"baseUrl":"https://api.example.com/v1","id":"some-model","apiKeyEnv":"OPENAI_API_KEY"}'`;
const MODELS_EXAMPLE = `'["deepseek/deepseek-flash","relay/gpt-5.6-sol"]'`;
const PROVIDER_EXAMPLE = `'{"api":"openai-completions","baseUrl":"https://api.example.com/v1","apiKeyEnv":"MY_API_KEY","models":[{"id":"some-model"}]}'`;
const PROVIDER_MODELS_EXAMPLE = `'[{"id":"some-model","contextWindow":128000}]'`;

/**
 * 点路径 → 字段。`models`、`providers.<id>`、`ingest.model` 与 `ingest.recall.model` 等是一整组，写成 JSON：只改其中
 * 一项会让组不完整。组里的各项要在整组已经写入之后才能逐个改（docs/specs/story/qa.md 输出 23）。自定义服务商的字段
 * 按 id 动态取，见 `PROVIDER_FIELDS`。
 */
export const CONFIG_FIELDS: Readonly<Record<string, FieldSpec>> = {
    "model.use": {kind: "text", required: true},
    "model.thinking": {kind: "choice", required: false, choices: EFFORTS},
    models: {kind: "json", required: true, example: MODELS_EXAMPLE},
    "qa.answer": {kind: "choice", required: false, choices: ["markdown", "structured"]},
    "ingest.model": {kind: "json", required: false, example: INGEST_MODEL_EXAMPLE},
    "ingest.model.baseUrl": {kind: "text", required: true},
    "ingest.model.id": {kind: "text", required: true},
    "ingest.model.apiKeyEnv": {kind: "envName", required: true},
    "ingest.model.contextWindow": {kind: "integer", required: false},
    "ingest.model.maxTokens": {kind: "integer", required: false},
    "ingest.model.price": {kind: "json", required: false, example: PRICE_EXAMPLE},
    "ingest.recall.enabled": {kind: "boolean", required: false},
    "ingest.personaCheck.enabled": {kind: "boolean", required: false},
    "ingest.recall.model": {kind: "json", required: false, example: INGEST_MODEL_EXAMPLE},
    "ingest.recall.model.baseUrl": {kind: "text", required: true},
    "ingest.recall.model.id": {kind: "text", required: true},
    "ingest.recall.model.apiKeyEnv": {kind: "envName", required: true},
    "ingest.recall.model.contextWindow": {kind: "integer", required: false},
    "ingest.recall.model.maxTokens": {kind: "integer", required: false},
    "ingest.recall.model.price": {kind: "json", required: false, example: PRICE_EXAMPLE},
    "qa.maxChapters": {kind: "integer", required: false},
    "qa.fullReadMaxChars": {kind: "integer", required: false},
};

/** `providers.<id>` 与 `providers.<id>.<字段>`。 */
const PROVIDER_FIELDS: Readonly<Record<string, FieldSpec>> = {
    "": {kind: "json", required: false, example: PROVIDER_EXAMPLE},
    name: {kind: "text", required: false},
    api: {kind: "choice", required: true, choices: PROVIDER_APIS},
    baseUrl: {kind: "text", required: true},
    apiKeyEnv: {kind: "envName", required: true},
    models: {kind: "json", required: true, example: PROVIDER_MODELS_EXAMPLE},
};

/** 第 1 版的路径（t16 之前）→ 第 2 版里对应的路径；只用来在报错里指路，不自动改写。 */
const LEGACY_PATHS: Readonly<Record<string, string>> = {
    "model.baseUrl": `providers.${LEGACY_PROVIDER_ID}.baseUrl`,
    "model.id": "model.use（写成 服务商/模型名），以及 providers.<id>.models",
    "model.apiKeyEnv": `providers.${LEGACY_PROVIDER_ID}.apiKeyEnv`,
    "model.api": `providers.${LEGACY_PROVIDER_ID}.api（openai-completions 或 openai-responses）`,
    "model.contextWindow": `providers.${LEGACY_PROVIDER_ID}.models（模型的 contextWindow）`,
    "model.maxTokens": `providers.${LEGACY_PROVIDER_ID}.models（模型的 maxTokens）`,
    "model.price": `providers.${LEGACY_PROVIDER_ID}.models（模型的 price）`,
};

const PROVIDER_ID = new RegExp(PROVIDER_ID_PATTERN, "u");

/** 字段名对应的字段；不认识时为 undefined。只认表里自己的键：`toString` 之类从原型继承来的名字不是字段。 */
function lookupField(name: string): FieldSpec | undefined {
    if (Object.hasOwn(CONFIG_FIELDS, name)) return CONFIG_FIELDS[name];
    const [section, id, field, ...rest] = name.split(".");
    if (section !== "providers" || id === undefined || !PROVIDER_ID.test(id) || rest.length > 0) return undefined;
    const key = field ?? "";
    return Object.hasOwn(PROVIDER_FIELDS, key) ? PROVIDER_FIELDS[key] : undefined;
}

const ENV_NAME = new RegExp(ENV_NAME_PATTERN, "u");

/**
 * 密钥环境变量名的写法不对时的说明，对时为 undefined。常见的错是把密钥本身贴进来，那样密钥就落进配置文件、又被
 * 输出回显，所以写法不对一律拒绝，说明里也不带原文。交互的 `init` 用同一条检查。
 */
export function envNameProblem(text: string): string | undefined {
    return ENV_NAME.test(text) ? undefined : "密钥环境变量名只能是字母、数字、下划线，也不能像密钥（例如 OPENAI_API_KEY），这里要填变量名，不是密钥本身";
}

/** 这个字段的值能不能原样回显：整组的 JSON 里可能有贴进来的密钥（哪怕最后被同名键覆盖），只回显字段名。 */
export function echoable(name: string): boolean {
    return fieldOf(name).kind !== "json";
}

function fieldOf(name: string): FieldSpec {
    const field = lookupField(name);
    if (field !== undefined) return field;
    const legacy = Object.hasOwn(LEGACY_PATHS, name) ? LEGACY_PATHS[name] : undefined;
    if (legacy !== undefined) throw new ConfigEditError(`${name} 是第 1 版配置的字段，配置已升级到第 2 版：改用 ${legacy}`);
    throw new ConfigEditError(`没有配置字段 ${name}；可用的：${[...Object.keys(CONFIG_FIELDS), "providers.<id>", ...Object.keys(PROVIDER_FIELDS).filter(key => key !== "").map(key => `providers.<id>.${key}`)].join("、")}`);
}

function decode(name: string, field: FieldSpec, text: string): unknown {
    switch (field.kind) {
        case "text":
            return text;
        case "envName": {
            const problem = envNameProblem(text);
            if (problem !== undefined) throw new ConfigEditError(`${name}：${problem}`);
            return text;
        }
        case "integer":
            if (!/^-?\d+$/u.test(text)) throw new ConfigEditError(`${name} 要写整数：${text}`);
            return Number(text);
        case "boolean":
            if (text !== "true" && text !== "false") throw new ConfigEditError(`${name} 只能是 true 或 false：${text}`);
            return text === "true";
        case "choice": {
            const choices = field.choices ?? [];
            if (!choices.includes(text)) throw new ConfigEditError(`${name} 只能是 ${choices.join("、")}：${text}`);
            return text;
        }
        case "json": {
            let value: unknown;
            try {
                value = JSON.parse(text) as unknown;
            } catch {
                // 不带原文：整组里可能有贴进来的密钥（实现审查 S4 第 1 条）。
                throw new ConfigEditError(`${name} 要写合法的 JSON，例如 ${field.example ?? "{}"}`);
            }
            // 整组写入时组里的密钥环境变量名同样要查：把密钥本身贴进来会落进配置文件。
            const apiKeyEnv = typeof value === "object" && value !== null ? (value as {apiKeyEnv?: unknown}).apiKeyEnv : undefined;
            const problem = typeof apiKeyEnv === "string" ? envNameProblem(apiKeyEnv) : undefined;
            if (problem !== undefined) throw new ConfigEditError(`${name}.apiKeyEnv：${problem}`);
            return value;
        }
    }
}

/**
 * 点路径对应的父对象和键；不存在的节（例如还没有 `qa`、`ingest`、`ingest.recall`）建出来。整组的字段（表里写成 JSON
 * 的那些）不建：`ingest.model.<字段>` 只能改已经整组写入的 `ingest.model`。改的是副本。
 */
function locate(config: Record<string, unknown>, name: string): {parent: Record<string, unknown>; key: string} {
    const path = name.split(".");
    const key = path.pop()!;
    let parent = config;
    path.forEach((segment, depth) => {
        const existing = parent[segment];
        const prefix = path.slice(0, depth + 1).join(".");
        if (typeof existing === "object" && existing !== null) parent = existing as Record<string, unknown>;
        else if (lookupField(prefix)?.kind === "json") throw new ConfigEditError(`还没有 ${prefix}：先用 nbstory config set ${prefix} '<JSON>' 整组写入，例如 ${lookupField(prefix)!.example ?? "{}"}`);
        else parent = parent[segment] = {};
    });
    return {parent, key};
}

/**
 * 改一个字段，返回通过校验的新配置；`config` 本身不变。形状不对抛 `QaError`（`qa_unconfigured`）；字段之间的约束不成立
 * （默认模型不在候选里、服务商 id 与目录重名等）是用法错误，抛 `ConfigEditError`。
 */
export function setConfigField(config: QaConfig, name: string, text: string, source: string, catalog: ConfigCatalog | null): QaConfig {
    const value = decode(name, fieldOf(name), text);
    const copy = structuredClone(config) as unknown as Record<string, unknown>;
    const {parent, key} = locate(copy, name);
    parent[key] = value;
    return checked(parseQaConfig(copy, source), catalog);
}

function checked(config: QaConfig, catalog: ConfigCatalog | null): QaConfig {
    const problems = configProblems(config, catalog);
    if (problems.length > 0) throw new ConfigEditError(problems.slice(0, 3).join("；"));
    return config;
}

/** 去掉一个可选字段；`ingest.recall`、`qa`、`ingest`、`providers` 里没有字段了就整节去掉。 */
export function unsetConfigField(config: QaConfig, name: string, source: string, catalog: ConfigCatalog | null): QaConfig {
    if (fieldOf(name).required) throw new ConfigEditError(`${name} 是必填字段，只能用 config set 改，不能去掉`);
    const copy = structuredClone(config) as unknown as Record<string, unknown>;
    const {parent, key} = locate(copy, name);
    delete parent[key];
    const ingest = copy.ingest as Record<string, unknown> | undefined;
    if (typeof ingest?.recall === "object" && ingest.recall !== null && Object.keys(ingest.recall).length === 0) delete ingest.recall;
    for (const section of ["qa", "ingest", "providers"]) {
        const value = copy[section];
        if (typeof value === "object" && value !== null && Object.keys(value).length === 0) delete copy[section];
    }
    return checked(parseQaConfig(copy, source), catalog);
}

/** `config init` 的回答：用 OMP 目录里的模型，或一个自定义地址（写进自定义服务商 `custom`）。 */
export type InitAnswers = {kind: "catalog"; ref: string} | {kind: "custom"; baseUrl: string; id: string; apiKeyEnv: string};

/**
 * 按 `config init` 的回答改配置（没有配置时从空的开始）：选的模型加进候选并设为默认，没问到的字段保留。`thinking`
 * 为 null 时去掉默认模型的推理档，undefined 时不动。字段之间的约束不成立是用法错误（`ConfigEditError`）。
 */
export function applyInitAnswers(existing: QaConfig | null, answers: InitAnswers | null, thinking: Effort | null | undefined, source: string, catalog: ConfigCatalog | null): QaConfig {
    const copy = structuredClone(existing ?? {models: [], model: {use: ""}}) as {providers?: Record<string, ProviderConfig>; models: string[]; model: {use: string; thinking?: Effort}};
    if (answers !== null) {
        let ref: string;
        if (answers.kind === "catalog") ref = answers.ref;
        else {
            const provider = copy.providers?.[LEGACY_PROVIDER_ID];
            const models = provider?.models ?? [];
            copy.providers = {
                ...copy.providers,
                [LEGACY_PROVIDER_ID]: {
                    ...provider,
                    api: provider?.api ?? "openai-completions",
                    baseUrl: answers.baseUrl,
                    apiKeyEnv: answers.apiKeyEnv,
                    // 给新的自定义模型写推理档时按推理模型发（同第 1 版的升级）：不然认不得的模型名不发推理档。
                    models: models.some(model => model.id === answers.id) ? models : [...models, {id: answers.id, ...(typeof thinking === "string" ? {reasoning: true} : {})}],
                },
            };
            ref = `${LEGACY_PROVIDER_ID}/${answers.id}`;
        }
        if (!copy.models.includes(ref)) copy.models = [...copy.models, ref];
        copy.model = {...copy.model, use: ref};
    }
    if (thinking === null) delete copy.model.thinking;
    else if (thinking !== undefined) copy.model.thinking = thinking;
    return checked(parseQaConfig(copy, source), catalog);
}
