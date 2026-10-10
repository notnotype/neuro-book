/**
 * 校验与规范化（Spec 输出 1、2）：先查 JSON 如实表示，再跑 schema，再查 schema 说不清的规则；三步的问题合在一起返回，
 * 调用方一次看到全部问题。通过后填缺省值、深冻结。
 */

import {Value} from "typebox/value";
import {HarnessConfigSchema, MODEL_REF_PATTERN} from "./schema";
import type {HarnessConfigInput} from "./schema";
import type {ConfigProblem, ConfigResult, HarnessConfig} from "./types";

/** TypeBox 的 `/providers/1/baseUrl` 写成 Spec 的 `providers[1].baseUrl`。 */
function pathOf(instancePath: string): string {
    return instancePath
        .split("/")
        .filter((segment) => segment !== "")
        .map((segment) => (/^\d+$/u.test(segment) ? `[${segment}]` : `.${segment}`))
        .join("")
        .replace(/^\./u, "");
}

function jsonProblems(value: unknown): ConfigProblem[] {
    const problems: ConfigProblem[] = [];
    const seen = new Set<object>();
    const visit = (current: unknown, path: string): void => {
        switch (typeof current) {
            case "number":
                if (!Number.isFinite(current)) problems.push({path, reason: `${String(current)} 不能用 JSON 表示`});
                return;
            case "undefined":
            case "function":
            case "bigint":
            case "symbol":
                problems.push({path, reason: `${typeof current} 不能用 JSON 表示`});
                return;
            case "object": {
                if (current === null) return;
                if (seen.has(current)) {
                    problems.push({path, reason: "循环引用"});
                    return;
                }
                seen.add(current);
                if (Array.isArray(current)) current.forEach((item, index) => visit(item, `${path}[${index}]`));
                else {
                    const prototype = Object.getPrototypeOf(current);
                    if (prototype !== Object.prototype && prototype !== null) problems.push({path, reason: `只允许普通对象，不允许 ${prototype.constructor?.name ?? "未知类型"}`});
                    else for (const [key, item] of Object.entries(current)) visit(item, path === "" ? key : `${path}.${key}`);
                }
                seen.delete(current);
                return;
            }
            default:
                return;
        }
    };
    visit(value, "");
    return problems;
}

/** 重复 id 的下标：第一次出现的算原件，之后每次出现各报一条。 */
function repeatIndexes(ids: readonly (string | undefined)[]): Set<number> {
    const seen = new Set<string>();
    const repeats = new Set<number>();
    ids.forEach((id, index) => {
        if (id === undefined) return;
        if (seen.has(id)) repeats.add(index);
        else seen.add(id);
    });
    return repeats;
}

/** 空字符串的模型引用按未给出处理。 */
const normalizeRef = (ref: string | null | undefined): string | undefined => (ref === null || ref === undefined || ref === "" ? undefined : ref);

const asRecord = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const ID_RULE = /^[A-Za-z0-9._-]+$/u;
/** 普通对象当字典用时这些键会改原型而不是存条目（JSON 文件里就能写出来），一律拒绝。 */
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function urlProblem(value: string): string | null {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return "不是合法的 URL";
    }
    // http(s) 是 WHATWG 的特殊协议，能解析就一定有主机名，不必再查
    if (url.protocol !== "http:" && url.protocol !== "https:") return "只支持 http 与 https";
    return null;
}

function reservedKeyProblems(record: Record<string, unknown> | null, path: string): ConfigProblem[] {
    return Object.keys(record ?? {}).filter((key) => RESERVED_KEYS.has(key)).map((key) => ({path: `${path}.${key}`, reason: "保留的键名，不能作为 id"}));
}

/** schema 说不清的规则：唯一性、模型引用语法、profiles 的键。输入可能没通过 schema，所以每一步都先看类型。 */
function ruleProblems(input: Record<string, unknown>): ConfigProblem[] {
    const problems: ConfigProblem[] = [];
    const providers = asArray(input.providers).map(asRecord);
    const repeatedProviders = repeatIndexes(providers.map((provider) => asString(provider?.id)));
    providers.forEach((provider, index) => {
        if (provider === null) return;
        if (repeatedProviders.has(index)) problems.push({path: `providers[${index}].id`, reason: `服务 id 重复：${String(provider.id)}`});
        const baseUrl = asString(provider.baseUrl);
        const badUrl = baseUrl === undefined ? null : urlProblem(baseUrl);
        if (badUrl !== null) problems.push({path: `providers[${index}].baseUrl`, reason: badUrl});
        problems.push(...reservedKeyProblems(asRecord(provider.headers), `providers[${index}].headers`));
        const models = asArray(provider.models).map(asRecord);
        const repeatedModels = repeatIndexes(models.map((model) => asString(model?.id)));
        models.forEach((model, modelIndex) => {
            if (repeatedModels.has(modelIndex)) problems.push({path: `providers[${index}].models[${modelIndex}].id`, reason: `模型 id 重复：${String(model?.id)}`});
        });
    });
    const roles = asArray(asRecord(input.roles)?.items).map(asRecord);
    const repeatedRoles = repeatIndexes(roles.map((role) => asString(role?.id)));
    roles.forEach((role, index) => {
        if (role === null) return;
        if (repeatedRoles.has(index)) problems.push({path: `roles.items[${index}].id`, reason: `角色 id 重复：${String(role.id)}`});
        const ref = normalizeRef(asString(role.modelKey));
        if (ref !== undefined && !MODEL_REF_PATTERN.test(ref)) problems.push({path: `roles.items[${index}].modelKey`, reason: `模型引用必须是 <providerId>/<modelId>：${ref}`});
    });
    const defaultModel = normalizeRef(asString(asRecord(input.models)?.defaultModel));
    if (defaultModel !== undefined && !MODEL_REF_PATTERN.test(defaultModel)) problems.push({path: "models.defaultModel", reason: `模型引用必须是 <providerId>/<modelId>：${defaultModel}`});
    problems.push(...reservedKeyProblems(asRecord(input.profiles), "profiles"));
    problems.push(...reservedKeyProblems(asRecord(asRecord(input.approval)?.tools), "approval.tools"));
    for (const [id, profile] of Object.entries(asRecord(input.profiles) ?? {})) {
        if (!ID_RULE.test(id) && !RESERVED_KEYS.has(id)) problems.push({path: `profiles.${id}`, reason: "Profile id 必须是 [A-Za-z0-9._-]+"});
        const ref = normalizeRef(asString(asRecord(profile)?.model));
        if (ref !== undefined && !MODEL_REF_PATTERN.test(ref)) problems.push({path: `profiles.${id}.model`, reason: `模型引用必须是 <providerId>/<modelId>：${ref}`});
    }
    return problems;
}

function deepFreeze<T>(value: T): T {
    if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
    for (const item of Object.values(value as object)) deepFreeze(item);
    return Object.freeze(value);
}

/** 填缺省值、去掉空字符串的引用；输入不被修改。 */
function normalize(input: HarnessConfigInput): HarnessConfig {
    const copy = structuredClone(input);
    const defaultModel = normalizeRef(copy.models?.defaultModel);
    const profiles: HarnessConfig["profiles"] = {};
    for (const [id, profile] of Object.entries(copy.profiles ?? {})) {
        const model = normalizeRef(profile.model);
        profiles[id] = {...(model === undefined ? {} : {model}), ...(profile.settings === undefined ? {} : {settings: profile.settings as HarnessConfig["profiles"][string]["settings"]})};
    }
    const config: HarnessConfig = {
        providers: copy.providers ?? [],
        models: defaultModel === undefined ? {} : {defaultModel},
        roles: {items: (copy.roles?.items ?? []).map((role) => ({...role, modelKey: normalizeRef(role.modelKey) ?? null}))},
        profiles,
        approval: {...(copy.approval?.mode === undefined ? {} : {mode: copy.approval.mode}), tools: copy.approval?.tools ?? {}},
    };
    return deepFreeze(config);
}

export function validateHarnessConfig(input: unknown): ConfigResult<HarnessConfig> {
    const problems = jsonProblems(input);
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        problems.push({path: "", reason: "配置必须是对象"});
        return {ok: false, code: "invalid-config", problems};
    }
    if (!Value.Check(HarnessConfigSchema, input)) {
        // 同一字段按路径合并：联合类型的每个分支各报一次，调用方只需要知道这个字段不对。
        const byPath = new Map<string, Set<string>>();
        for (const error of Value.Errors(HarnessConfigSchema, input)) {
            const unknownKeys = (error as {params?: {additionalProperties?: unknown}}).params?.additionalProperties;
            if (Array.isArray(unknownKeys)) {
                // 未知字段每个一条，路径指到字段本身而不是所在的对象。
                const base = pathOf(error.instancePath);
                for (const key of unknownKeys) problems.push({path: base === "" ? String(key) : `${base}.${String(key)}`, reason: "未知字段"});
                continue;
            }
            const path = pathOf(error.instancePath);
            const reasons = byPath.get(path) ?? new Set<string>();
            reasons.add(error.message);
            byPath.set(path, reasons);
        }
        for (const [path, reasons] of byPath) problems.push({path, reason: [...reasons].join("；")});
    }
    // schema 不通过时规则检查也照跑（对拿得到的部分），一次列出全部问题。
    problems.push(...ruleProblems(input as Record<string, unknown>));
    if (problems.length > 0) return {ok: false, code: "invalid-config", problems};
    return {ok: true, value: normalize(input as HarnessConfigInput)};
}
