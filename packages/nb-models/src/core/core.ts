/**
 * 模型服务的核心（docs/specs/models/service.md）：快照、串行写入、模型端口与给设置页的远程实现。应用的插件入口打开凭据库、
 * 把自己的设置服务适配成 `ModelsConfigStore`，再建核心、用自己的服务键与合同 id 交出 `service` 与 `remote`。
 *
 * 两条贯穿全文件的约束：
 * - 所有写入（两个配置项、凭据库）排进同一个串行队列 `queue`；配置项每次“读本层当前值 → 合并 → 带 `expect` 写回”，
 *   冲突就重读重来（输出 6）。快照的失效也在这条队列之外即时发生：配置的订阅与凭据库的变化通知都只把缓存作废。
 * - `resolve` 同步，读的是缓存的快照与按引用缓存的解析结果；缓存在配置或凭据变化时整体作废（输出 7）。
 */

import {createHash, createHmac, randomBytes} from "node:crypto";

import type {ModelPort, ModelQuery, ModelRequest, ModelResolution} from "@notnotype/nb-harness/kernel/contracts";
import {buildResolution, discoverModels, envRefName, envValue, requestAuth, templateRoutes} from "@notnotype/nb-harness/models";
import type {CredentialStore, KeyAccess, ModelTarget, ProviderTarget, StartupEnv, WireApi} from "@notnotype/nb-harness/models";
import {eventSource} from "@notnotype/nb-runtime/remote";
import type {RemoteImplementation, RemoteOutcome} from "@notnotype/nb-runtime/remote";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";

import {compactionTrigger, effectiveCompaction} from "../config/compaction";
import {normalizeProviders} from "../config/normalize";
import {missingContextWindow, providerIdFor, referenceOf, roleOfReference, rolesUsing, seriesOf, splitReference} from "../config/rules";
import {BLANK_API, BUILTIN_ROLES, DEFAULT_ROLES, isBlankTemplate, MODEL_ROLE_IDS} from "../config/shapes";
import type {BlankTemplate, ModelConfig, ProviderConfig, ProviderIcon, RoleConfig, RolesConfig, StoredProvider} from "../config/shapes";
import type {ModelsService, ProfileModelDefaults} from "../contract/service";
import type {ModelsSettingsContract} from "../contract/settings-spec";
import type {CheckResult, KeyStatus, ModelRow, ModelsSnapshot, RoleStatus, SnapshotProvider, Template} from "../contract/shapes";
import {chooseModel} from "./choice";
import {checkPng, ICON_NAME} from "./icons";
import {availableMembers, findMember, listedMembers, sourceModels, windowOf} from "./members";
import type {MemberRow} from "./members";
import type {ConfigKey, ConfigSlot, ModelsConfigStore, SlotWriteResult} from "./store";
import {defaultApi, listTemplates, templateOf} from "./templates";

/** 冲突后重读重来的次数（输出 6）。 */
const WRITE_ATTEMPTS = 3;
/**
 * 冲突之后等设置的视图跟上磁盘的上限：冲突说明文件被别处改过，本实例的快照要等拥有者重读、推来才是新的；推不来（例如那次
 * 写入的快照早就到了）就到点照样重试。
 */
const CATCH_UP_MS = 1_000;
/** 检测：最大输出、超时与批量并发（输出 11）。 */
const CHECK_MAX_OUTPUT = 32;
const CHECK_TIMEOUT_MS = 30_000;
const CHECK_CONCURRENCY = 4;

/** 上传图标的文件存放（应用给：状态根下的目录）；名字是内容的 SHA-256 加 `.png`。 */
export interface IconStore {
    save(name: string, bytes: Uint8Array): Promise<void>;
    /** 不存在算成功。 */
    remove(name: string): Promise<void>;
    list(): Promise<readonly string[]>;
}

export interface ModelsCoreDeps {
    readonly config: ModelsConfigStore;
    readonly credentials: CredentialStore;
    readonly env: StartupEnv;
    /** 状态根里的随机密钥：会话日志里的凭据身份用它做 HMAC，不落原文。 */
    readonly secret: Uint8Array | string;
    readonly icons: IconStore;
    /** 诊断；事件名是 `models.catalog.missing` 与 `models.credentials.failed`。 */
    readonly record: (level: "info" | "warn", event: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

export interface ModelsCore {
    readonly service: ModelsService;
    remote(consumer: ConsumerIdentity): RemoteImplementation<ModelsSettingsContract>;
    /** 等队列里已接纳的写入走完，摘掉订阅；凭据库由入口关。 */
    close(): Promise<void>;
}

type Methods = ModelsSettingsContract["methods"];
/** 合同里各方法声明过的业务失败（失败码表随合同定义在 `contract/settings-spec.ts`）；写入的每一步交回其中一种。 */
type Failure = {[Name in keyof Methods]: Exclude<RemoteOutcome<Methods[Name]>, {readonly ok: true}>}[keyof Methods];
type Step<T> = {readonly ok: true; readonly value: T} | Failure;
/** 详情是 `{detail}` 加上这个码要的别的字段；码只能是合同里有的，详情的形状由远程层按合同核对。 */
const failure = (code: Failure["code"], detail: string, extra: Record<string, unknown> = {}): Failure => ({ok: false, code, detail: {detail, ...extra}}) as Failure;
const BUILTIN = new Set(BUILTIN_ROLES.map((role) => role.id));
/**
 * 把写入步骤的业务失败原样交给远程实现：每个步骤只产生它所在方法在合同里声明过的码（`mutate` 的配置失败映射、各方法自己的
 * 码），类型系统表达不出“这一步属于哪个方法”，在这一处断言。
 */
const relay = (step: Failure): never => step as never;

/** `setRole` 的补丁：省略不改，`null` 清除（`model` 清成未绑定，`effort`、`icon` 去掉键）。 */
function patchRole(role: RoleConfig, patch: {readonly model?: string | null; readonly effort?: RoleConfig["effort"] | null; readonly icon?: string | null}): RoleConfig {
    const {effort, icon, ...rest} = role;
    const nextEffort = patch.effort === undefined ? effort : patch.effort ?? undefined;
    const nextIcon = patch.icon === undefined ? icon : patch.icon ?? undefined;
    return {...rest, model: patch.model === undefined ? role.model : patch.model, ...(nextEffort === undefined ? {} : {effort: nextEffort}), ...(nextIcon === undefined ? {} : {icon: nextIcon})};
}

/** 服务商名称不与已有的重名（忽略大小写与首尾空白）：重名时加“ 2”“ 3”。`taken` 里是已有名称的小写形式。 */
function uniqueName(base: string, taken: ReadonlySet<string>): string {
    const trimmed = base.trim();
    if (!taken.has(trimmed.toLowerCase())) return trimmed;
    for (let suffix = 2; ; suffix += 1) {
        const candidate = `${trimmed} ${String(suffix)}`;
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
}

const validAddress = (value: string): boolean => {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
};

/** 一个服务商的版本号：配置或密钥状态变了就变，调用方据此判断自己读到的行是否还新。 */
const revisionOf = (provider: ProviderConfig, key: KeyStatus): string => Bun.hash(JSON.stringify([provider, key])).toString(36);

/** 写入设置的整份服务商值的帧字节上限（RPC 单帧 1 MiB，留余量）：按 JSON 转义后的字节算。 */
const SETTINGS_FRAME_LIMIT = 768 * 1024;

/** 唯一的随机 128 位标识。 */
const newUid = (): string => randomBytes(16).toString("hex");

export function createModelsCore(deps: ModelsCoreDeps): ModelsCore {
    const {config, credentials, env} = deps;
    /** 设置里存着的值归一成 v2（v1 的读法见 `normalizeProviders`）；每次都现读现算，服务商数量与条目数都很小。 */
    const providers = (): readonly ProviderConfig[] => normalizeProviders(config.providers.read());
    const roles = (): readonly RoleConfig[] => config.roles.read().items;
    const access: KeyAccess = {stored: (provider) => credentials.get(provider), env};
    /** 重发归内核（docs/specs/models/service.md 输出 16），所以 HTTP 只发一次。每次请求现读。 */
    const transport = () => {
        const stream = config.stream();
        return {firstEventTimeoutMs: stream.firstEventTimeoutSeconds * 1000, idleTimeoutMs: stream.idleTimeoutSeconds * 1000, maxHttpAttempts: 1};
    };

    // ---- 快照与解析结果的缓存 ----
    let snapshotCache: ModelsSnapshot | null = null;
    let normalizedCache: readonly ProviderConfig[] | null = null;
    const resolutions = new Map<string, ModelResolution>();
    const rowCache = new Map<string, ModelRow>();
    const listeners = new Set<() => void>();
    // 订阅时先推一次当前快照（先登记再推，期间的变化不会漏，见 eventSource）。
    const changed = eventSource<ModelsSnapshot>({onSubscribe: (_filter, sink) => sink.next(snapshot())});
    const invalidate = (): void => {
        snapshotCache = null;
        normalizedCache = null;
        resolutions.clear();
        rowCache.clear();
        const next = snapshot();
        for (const listener of [...listeners]) listener();
        changed.emit(next);
    };
    const offConfig = config.onChange(invalidate);
    const offCredentials = credentials.onChange(invalidate);
    const current = (): readonly ProviderConfig[] => (normalizedCache ??= providers());

    // ---- 实例到解析的转换 ----
    const regionBaseUrl = (provider: ProviderConfig): string | undefined => (provider.region === undefined ? undefined : templateOf(provider.template)?.regions.find((region) => region.id === provider.region)?.baseUrl);
    /** 空白模板没有目录：协议用实例自己的（建立时写入），缺了用模板的缺省。 */
    const effectiveApi = (provider: ProviderConfig): WireApi | null => provider.api ?? defaultApi(provider.template);
    /** 实例生效的地址：覆盖，其次地区，再次模板给这个协议的路由。 */
    const effectiveBaseUrl = (provider: ProviderConfig): string | null => {
        if (provider.baseUrl !== undefined) return provider.baseUrl;
        const region = regionBaseUrl(provider);
        if (region !== undefined) return region;
        const api = effectiveApi(provider);
        return api === null || isBlankTemplate(provider.template) ? null : templateRoutes(provider.template).find((route) => route.api === api)?.baseUrl ?? null;
    };
    const follows = (provider: ProviderConfig): boolean => !isBlankTemplate(provider.template) && provider.api === undefined && provider.baseUrl === undefined;
    const targetOf = (provider: ProviderConfig): ProviderTarget => {
        const baseUrl = provider.baseUrl ?? regionBaseUrl(provider);
        const api = isBlankTemplate(provider.template) ? effectiveApi(provider) : provider.api;
        return {
            id: provider.id,
            template: isBlankTemplate(provider.template) ? null : provider.template,
            follows: follows(provider),
            auth: provider.auth,
            ...(api === null || api === undefined ? {} : {api}),
            ...(baseUrl === undefined ? {} : {baseUrl}),
            ...(provider.apiKeyEnv === undefined ? {} : {apiKeyEnv: provider.apiKeyEnv}),
            ...(provider.headers === undefined ? {} : {headers: provider.headers}),
        };
    };
    const modelTargetOf = (id: string, entry: ModelConfig | undefined): ModelTarget => ({
        id,
        ...(entry?.name === undefined ? {} : {name: entry.name}),
        ...(entry?.contextWindow === undefined ? {} : {contextWindow: entry.contextWindow}),
        ...(entry?.maxOutput === undefined ? {} : {maxOutput: entry.maxOutput}),
        ...(entry?.vision === undefined ? {} : {vision: entry.vision}),
        ...(entry?.reasoning === undefined ? {} : {reasoning: entry.reasoning}),
        // 触发点要等窗口知道了才算得出；全局设置每次现读，设置改了从下一次解析起生效。
        compactAtFor: (contextWindow) => compactionTrigger(effectiveCompaction(entry ?? {}, config.compaction()), contextWindow),
        ...(entry?.price === undefined ? {} : {price: entry.price}),
        ...(entry?.headers === undefined ? {} : {headers: entry.headers}),
    });
    const secret = typeof deps.secret === "string" ? deps.secret : Buffer.from(deps.secret);
    /** 签名绑定凭据的协议另带凭据身份；OpenAI 兼容的对话没有签名。 */
    const signsWithCredential = (api: WireApi): boolean => api !== "openai-completions";
    /** 部署身份：实例的 `uid` 加有效地址与协议；同名重建（新 `uid`）、换地址与协议后都不同，旧日志的签名不再还原。 */
    const identityOf = (provider: ProviderConfig) => (effective: {readonly api: WireApi; readonly baseUrl: string; readonly key: string | null}) => ({
        deployment: createHash("sha256").update(`${provider.uid}\n${effective.api}\n${effective.baseUrl}`).digest("hex").slice(0, 32),
        ...(effective.key !== null && signsWithCredential(effective.api) ? {credential: createHmac("sha256", secret).update(effective.key).digest("hex").slice(0, 32)} : {}),
        legacyProvider: provider.id,
    });
    /** 解析之后实例被改了（地址、协议、认证方式、`uid`）或密钥换了，旧解析不能再发（防止新密钥发往旧地址）。 */
    const stillCurrentFor = (provider: ProviderConfig) => {
        const fingerprint = (item: ProviderConfig): string => JSON.stringify([item.uid, effectiveApi(item), effectiveBaseUrl(item), item.auth, item.apiKeyEnv ?? null, follows(item)]);
        const resolvedWith = fingerprint(provider);
        const key = requestAuth(targetOf(provider), null, access).key;
        return (): boolean => {
            const now = current().find((item) => item.uid === provider.uid);
            return now !== undefined && fingerprint(now) === resolvedWith && requestAuth(targetOf(now), null, access).key === key;
        };
    };
    const build = (provider: ProviderConfig, row: MemberRow) => buildResolution(targetOf(provider), modelTargetOf(row.id, row.entry), access, {transport, identityOf: identityOf(provider), stillCurrent: stillCurrentFor(provider)});

    const keyStatusOf = (provider: ProviderConfig): KeyStatus => {
        if (provider.auth === "none") return {kind: "keyless"};
        if (provider.apiKeyEnv !== undefined) return {kind: "env", name: provider.apiKeyEnv, found: envValue(env, provider.apiKeyEnv) !== null};
        return credentials.get(provider.id) === null ? {kind: "none"} : {kind: "stored"};
    };
    const keyReady = (status: KeyStatus): boolean => status.kind === "stored" || status.kind === "keyless" || (status.kind === "env" && status.found);

    /** 一个引用解析成什么：模型端口与角色有效性共用，结论一致（输出 8）。 */
    const resolveReference = (reference: string): ModelResolution => {
        const cached = resolutions.get(reference);
        if (cached !== undefined) return cached;
        const result = ((): ModelResolution => {
            const target = splitReference(reference);
            const provider = target === null ? undefined : current().find((item) => item.id === target.provider);
            const row = target === null || provider === undefined ? undefined : findMember(provider, target.model);
            if (provider === undefined || row === undefined || row.entry?.enabled === false) return {ok: false, code: "unknown-model"};
            // 目录漂移（输出 9）与上下文窗口不明：先于凭据判断，界面才能指出是模型的问题。
            if (statusOf(row) !== "ok") return {ok: false, code: "unknown-model"};
            if (!keyReady(keyStatusOf(provider))) return {ok: false, code: "no-credentials", provider: provider.id};
            const built = build(provider, row);
            return built.ok ? built.resolution : {ok: false, code: "unknown-model"};
        })();
        resolutions.set(reference, result);
        return result;
    };
    const resolveRole = (id: string): ModelResolution => {
        const role = roles().find((item) => item.id === id);
        if (role === undefined || role.model === null) return {ok: false, code: "role-unbound", role: id};
        // 失败带上角色：界面说的是“这个角色的模型用不了”，去改的是这个角色（docs/specs/models/service.md）。
        const resolved = resolveReference(role.model);
        // 角色的默认档是这一次解析的属性，不进按引用缓存的 `info`：同一个模型绑给两个角色，各用各的。
        if (resolved.ok) return {...resolved, role: id, ...(role.effort === undefined ? {} : {defaultEffort: role.effort})};
        return {...resolved, role: id};
    };
    /** 会话里选的：模型引用或 `role:<id>`。选过的角色后来被删了是选择失效（`unknown-model`），和没绑定不同：去改的地方不一样。 */
    const resolveSelection = (selection: string): ModelResolution => {
        const roleId = roleOfReference(selection);
        if (roleId === null) return resolveReference(selection);
        return roles().some((item) => item.id === roleId) ? resolveRole(roleId) : {ok: false, code: "unknown-model"};
    };

    const roleStatus = (role: RoleConfig): RoleStatus => {
        if (role.model === null) return "unbound";
        const resolution = resolveReference(role.model);
        return resolution.ok ? "ok" : resolution.code === "no-credentials" ? "no-credentials" : "unknown-model";
    };

    // ---- 模型行 ----
    /** `missing`：设置里是来源模型、目录里已经没有；`incomplete`：上下文窗口不明（目录没给、用户也没填）。 */
    const statusOf = (row: MemberRow): ModelRow["status"] => (row.origin === "source" && row.source === undefined ? "missing" : windowOf(row) === null ? "incomplete" : "ok");

    /** 这个模型的推理能力：按真实的 OMP 模型算；建不出模型（目录漂移、窗口不明）时按配置的能力字段退一步。 */
    const reasoningOfRow = (provider: ProviderConfig, row: MemberRow): ModelRow["thinking"] => {
        const built = build(provider, row);
        const reasoning = built.ok ? built.resolution.info.reasoning : undefined;
        if (reasoning !== undefined) return reasoning.kind === "levels" ? {...reasoning, levels: [...reasoning.levels]} : reasoning;
        return {kind: (row.entry?.reasoning ?? row.source?.reasoning ?? false) ? "fixed" : "none"};
    };

    const OVERRIDES = ["name", "contextWindow", "maxOutput", "vision", "reasoning", "price"] as const;
    const sourcePriceOf = (source: MemberRow["source"]): ModelRow["price"] => (source?.price === null || source?.price === undefined ? null : [source.price.input, source.price.output, source.price.cacheRead ?? 0, source.price.cacheWrite ?? 0]);
    const rowOf = (provider: ProviderConfig, row: MemberRow, ready: boolean): ModelRow => {
        const cacheKey = `${provider.uid}\n${row.id}`;
        const cached = rowCache.get(cacheKey);
        if (cached !== undefined) return cached;
        const {entry, source} = row;
        const status = statusOf(row);
        const enabled = entry?.enabled ?? true;
        const overridden = row.origin === "source" && source !== undefined && entry !== undefined
            ? OVERRIDES.filter((field) => {
                switch (field) {
                    case "name": return entry.name !== undefined && entry.name !== source.name;
                    case "contextWindow": return entry.contextWindow !== undefined && entry.contextWindow !== source.contextWindow;
                    case "maxOutput": return entry.maxOutput !== undefined && entry.maxOutput !== source.maxTokens;
                    case "vision": return entry.vision !== undefined && entry.vision !== source.images;
                    case "reasoning": return entry.reasoning !== undefined && entry.reasoning !== source.reasoning;
                    case "price": return entry.price !== undefined && JSON.stringify(entry.price) !== JSON.stringify(sourcePriceOf(source));
                }
            })
            : [];
        const value: ModelRow = {
            id: row.id,
            name: entry?.name ?? source?.name ?? row.id,
            group: entry?.group ?? seriesOf(row.id),
            enabled,
            origin: row.origin,
            contextWindow: windowOf(row),
            maxOutput: entry?.maxOutput ?? source?.maxTokens ?? null,
            vision: entry?.vision ?? source?.images ?? false,
            reasoning: entry?.reasoning ?? source?.reasoning ?? false,
            efforts: [...(entry?.efforts ?? source?.efforts ?? [])],
            thinking: reasoningOfRow(provider, row),
            compaction: entry?.compaction ?? (entry?.compactAt === undefined ? null : {mode: "tokens", value: entry.compactAt}),
            price: entry?.price !== undefined ? entry.price : sourcePriceOf(source),
            headers: {...entry?.headers},
            status,
            usable: usableMember(provider, row, ready),
            overridden,
        };
        rowCache.set(cacheKey, value);
        return value;
    };

    // ---- 快照 ----
    let missingReported = new Set<string>();
    function snapshot(): ModelsSnapshot {
        if (snapshotCache !== null) return snapshotCache;
        const list: SnapshotProvider[] = current().map((provider) => {
            const members = listedMembers(provider);
            const key = keyStatusOf(provider);
            const template = templateOf(provider.template);
            return {
                id: provider.id,
                template: provider.template,
                region: provider.region ?? null,
                name: provider.name,
                icon: provider.icon ?? null,
                baseUrl: effectiveBaseUrl(provider),
                templateBaseUrl: isBlankTemplate(provider.template) ? null : template?.routes.find((route) => route.api === effectiveApi(provider))?.baseUrl ?? template?.routes[0]?.baseUrl ?? null,
                api: effectiveApi(provider),
                templateApi: isBlankTemplate(provider.template) ? BLANK_API[provider.template as BlankTemplate] : defaultApi(provider.template),
                auth: provider.auth,
                headers: {...provider.headers},
                key,
                followSource: provider.followSource,
                source: {kind: "packaged"},
                modelCount: members.length,
                enabledCount: members.filter((row) => row.entry?.enabled !== false).length,
                excludedCount: provider.excluded.length,
                modelsRevision: revisionOf(provider, key),
            };
        });
        // 目录漂移（输出 9）：设置里引用的来源模型不在目录里了，每个只诊断一次。
        const missing = new Set(current().flatMap((provider) => listedMembers(provider).filter((row) => statusOf(row) === "missing").map((row) => referenceOf(provider.id, row.id))));
        for (const reference of missing) if (!missingReported.has(reference)) deps.record("warn", "models.catalog.missing", "A configured catalog model is no longer in the catalog", {model: reference});
        missingReported = missing;
        snapshotCache = {
            providers: list,
            roles: roles().map((role) => ({id: role.id, axis: role.axis, builtin: BUILTIN.has(role.id), name: role.name, description: role.description, model: role.model, effort: role.effort ?? null, icon: role.icon ?? null, status: roleStatus(role)})),
        };
        return snapshotCache;
    }

    /** 等这个键的下一次变化，最多 `CATCH_UP_MS`。 */
    const changeOf = (key: ConfigKey): Promise<void> => new Promise((resolve) => {
        const timer = setTimeout(done, CATCH_UP_MS);
        const off = config.onChange((keys) => {
            if (keys.has(key)) done();
        });
        function done(): void {
            clearTimeout(timer);
            off();
            resolve();
        }
    });

    // ---- 串行写入 ----
    let tail: Promise<unknown> = Promise.resolve();
    const queue = <T>(work: () => Promise<T>): Promise<T> => {
        const run = tail.then(work, work);
        tail = run.catch(() => undefined);
        return run;
    };

    /**
     * 读本层当前值、合并、带 `expect` 写回；`conflict`（期间别处写过文件）就重读重来（输出 6）。`transform` 拿到的是用户层
     * 的值（没有时是缺省值），交回下一份值或业务失败。`expect` 用磁盘上的原值，所以 v1 形状的值也不会因归一而误判冲突。
     */
    async function mutate<V, R>(key: ConfigKey, slot: ConfigSlot<V>, fallback: V, transform: (current: V) => Step<{next: V; result: R}>): Promise<Step<R>> {
        for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt += 1) {
            const layer = slot.editable();
            if (layer.status !== "ok") return failure("settings-unavailable", "the user settings layer is not writable", {code: layer.status === "invalid" ? "layer-invalid" : "unavailable"});
            // 读到的值可能是冻结的，合并要改它：取一份可改的拷贝。
            const base = layer.value === undefined ? fallback : structuredClone(layer.value);
            const step = transform(base);
            if (!step.ok) return step;
            const written: SlotWriteResult = await slot.write(step.value.next, {value: layer.value});
            if (written.ok) return {ok: true, value: step.value.result};
            if (written.code === "conflict") {
                await changeOf(key);
                continue;
            }
            const detail = written.detail ?? "";
            if (written.code === "invalid-value") return failure("invalid-value", detail);
            return failure("settings-unavailable", detail, {code: written.code});
        }
        return failure("write-conflict", "the settings kept changing while writing");
    }
    /** 服务商的写入：读时归一成 v2，写回整份 v2（第一次写入就把 v1 的条目换成新形状）；超过帧预算的拒绝。 */
    const editProviders = <R>(transform: (list: ProviderConfig[]) => Step<{next: ProviderConfig[]; result: R}>) =>
        mutate<StoredProvider[], R>("providers", config.providers, [], (stored) => {
            const step = transform(normalizeProviders(stored));
            if (!step.ok) return step;
            if (Buffer.byteLength(JSON.stringify(step.value.next)) > SETTINGS_FRAME_LIMIT) return failure("invalid-value", "the providers setting would exceed the 768 KiB limit; remove models or providers first");
            return {ok: true, value: {next: step.value.next, result: step.value.result}};
        });
    const editRoles = <R>(transform: (value: RolesConfig) => Step<{next: RolesConfig; result: R}>) => mutate<RolesConfig, R>("roles", config.roles, structuredClone(DEFAULT_ROLES), transform);
    const unknownProvider = (id: string): Failure => failure("unknown-provider", `no provider ${id}`);
    /** 删掉服务商或模型之后，绑着它们的角色解除绑定（变成未绑定，而不是指向不存在的模型）。 */
    const unbind = (provider: string, models?: readonly string[]): Promise<Step<null>> =>
        editRoles<null>((value) => {
            const stale = (role: RoleConfig) => role.model !== null && rolesUsing([role], provider).length > 0 && (models === undefined || models.includes(splitReference(role.model)!.model));
            if (!value.items.some(stale)) return {ok: true, value: {next: value, result: null}};
            return {ok: true, value: {next: {items: value.items.map((role) => (stale(role) ? {...role, model: null} : role))}, result: null}};
        });
    const withProvider = <R>(id: string, change: (provider: ProviderConfig, list: ProviderConfig[]) => Step<{provider: ProviderConfig | null; result: R}>) =>
        editProviders<R>((list) => {
            const index = list.findIndex((item) => item.id === id);
            if (index < 0) return unknownProvider(id);
            const step = change(list[index]!, list);
            if (!step.ok) return step;
            const next = step.value.provider === null ? list.filter((_, at) => at !== index) : list.map((item, at) => (at === index ? step.value.provider! : item));
            return {ok: true, value: {next, result: step.value.result}};
        });

    // ---- 写进设置的样子 ----
    const sourcePriceTuple = sourcePriceOf;
    /**
     * 写进设置的条目（service.md 输入一节）：来源模型只存用户改过的字段，其余跟着目录走，目录更新后没改过的字段随之更新；手加的模型
     * 整条存。请求头为空时不存。
     */
    const storedEntry = (provider: ProviderConfig, model: ModelConfig): ModelConfig => {
        const source = sourceModels(provider.template).get(model.id);
        const previous = provider.models.find((item) => item.id === model.id);
        if (source === undefined) {
            const {frozen: _frozen, ...rest} = model;
            return {...rest, origin: model.origin ?? previous?.origin ?? "manual"};
        }
        return {
            id: model.id,
            enabled: model.enabled,
            origin: "source",
            ...(model.name === undefined || model.name === source.name ? {} : {name: model.name}),
            ...(model.group === undefined || model.group === seriesOf(model.id) ? {} : {group: model.group}),
            ...(model.contextWindow === undefined || model.contextWindow === source.contextWindow ? {} : {contextWindow: model.contextWindow}),
            ...(model.maxOutput === undefined || model.maxOutput === source.maxTokens ? {} : {maxOutput: model.maxOutput}),
            ...(model.vision === undefined || model.vision === source.images ? {} : {vision: model.vision}),
            ...(model.reasoning === undefined || model.reasoning === source.reasoning ? {} : {reasoning: model.reasoning}),
            ...(model.price === undefined || JSON.stringify(model.price) === JSON.stringify(sourcePriceTuple(source)) ? {} : {price: model.price}),
            ...(model.compactAt === undefined ? {} : {compactAt: model.compactAt}),
            ...(model.compaction === undefined ? {} : {compaction: model.compaction}),
            ...(model.headers === undefined || Object.keys(model.headers).length === 0 ? {} : {headers: model.headers}),
        };
    };
    /** 开着自动加入时，只含 id 与“启用”的来源条目没有信息量，不存。 */
    const redundant = (provider: ProviderConfig, entry: ModelConfig): boolean => provider.followSource && entry.origin === "source" && entry.enabled && Object.keys(entry).length === 3;

    const incomplete = (provider: ProviderConfig, models: readonly ModelConfig[]): Failure | null => {
        const sources = sourceModels(provider.template);
        const bad = models.find((model) => model.enabled && missingContextWindow(model, sources.get(model.id)?.contextWindow ?? null));
        return bad === undefined ? null : failure("model-incomplete", `model ${bad.id} needs a context window before it can be enabled`);
    };

    /** 加入：来源模型取消移出（没开自动加入时补条目），手加的新建或整条替换。 */
    const withAdded = (provider: ProviderConfig, models: readonly ModelConfig[]): ProviderConfig => {
        const entries = models.map((model) => storedEntry(provider, model));
        const replaced = new Set(entries.map((entry) => entry.id));
        const kept = provider.models.filter((entry) => !replaced.has(entry.id));
        return {...provider, excluded: provider.excluded.filter((id) => !replaced.has(id)), models: [...kept, ...entries.filter((entry) => !redundant(provider, entry))]};
    };
    /** 移出：来源模型进 `excluded`（覆盖不保留），手加的删除。 */
    const withRemoved = (provider: ProviderConfig, ids: readonly string[]): ProviderConfig => {
        const sources = sourceModels(provider.template);
        const gone = new Set(ids);
        return {...provider, excluded: [...new Set([...provider.excluded, ...ids.filter((id) => sources.has(id))])], models: provider.models.filter((entry) => !gone.has(entry.id))};
    };
    /** 打开或关闭“自动加入”：关的时候给此刻有效、还没有条目的来源成员补冻结条目；开的时候只删仍是纯冻结的条目，用户改过的去掉冻结标记。 */
    const withFollow = (provider: ProviderConfig, follow: boolean): ProviderConfig => {
        if (provider.followSource === follow) return provider;
        if (!follow) {
            const entries = new Set(provider.models.map((entry) => entry.id));
            const frozen: ModelConfig[] = listedMembers(provider).filter((row) => row.source !== undefined && !entries.has(row.id)).map((row) => ({id: row.id, origin: "source", enabled: true, frozen: true}));
            return {...provider, followSource: false, models: [...provider.models, ...frozen]};
        }
        const models = provider.models.flatMap((entry): ModelConfig[] => {
            if (entry.frozen !== true) return [entry];
            if (entry.enabled && Object.keys(entry).length === 4) return [];
            const {frozen: _frozen, ...rest} = entry;
            return [rest];
        });
        return {...provider, followSource: true, models};
    };

    // ---- 凭据 ----
    const credentialStep = async (work: () => Promise<void>): Promise<Step<null>> => {
        try {
            await work();
            return {ok: true, value: null};
        } catch (error) {
            deps.record("warn", "models.credentials.failed", "Reading or writing the credential store failed", {error: error instanceof Error ? error.message : String(error)});
            return failure("credentials-unavailable", "the credential store could not be written");
        }
    };
    const statusNow = (id: string): KeyStatus => {
        const provider = current().find((item) => item.id === id);
        return provider === undefined ? {kind: "none"} : keyStatusOf(provider);
    };
    const partial = (id: string, step: Failure): Failure => ({ok: false, code: "partially-applied", detail: {key: statusNow(id), detail: `only the first of two writes applied (${step.code})`}});
    const setApiKeyEnv = (id: string, name: string | undefined) => withProvider<null>(id, (provider) => {
        const {apiKeyEnv: _old, ...rest} = provider;
        return {ok: true, value: {provider: name === undefined ? rest : {...rest, apiKeyEnv: name}, result: null}};
    });

    // ---- 图标文件 ----
    /** 删没有任何服务商引用的图标文件；失败只记诊断（孤立文件下次再收）。 */
    const collectIcons = async (): Promise<void> => {
        try {
            const used = new Set(current().flatMap((provider) => (provider.icon?.kind === "file" ? [provider.icon.name] : [])));
            for (const name of await deps.icons.list()) if (ICON_NAME.test(name) && !used.has(name)) await deps.icons.remove(name);
        } catch (error) {
            deps.record("warn", "models.icons.collect-failed", "Removing unused provider icons failed", {error: error instanceof Error ? error.message : String(error)});
        }
    };

    // ---- 检测 ----
    const probe: ModelRequest = {purpose: "background", model: "", params: {}, headers: {}, system: [], messages: [{role: "user", content: [{kind: "text", text: "ping", origin: {kind: "fixed", by: "kernel"}}]}], tools: []};
    async function check(provider: ProviderConfig, row: MemberRow, signal: AbortSignal): Promise<CheckResult> {
        if (statusOf(row) === "incomplete") return {ok: false, kind: "local", code: "model-incomplete", raw: ""};
        const built = build(provider, row);
        if (!built.ok) return {ok: false, kind: "local", code: "unknown-model", raw: ""};
        const timeout = AbortSignal.timeout(CHECK_TIMEOUT_MS);
        const combined = AbortSignal.any([signal, timeout]);
        const maxTokens = Math.min(CHECK_MAX_OUTPUT, built.resolution.info.maxOutput ?? CHECK_MAX_OUTPUT);
        const response = await built.resolution.call({...probe, model: built.resolution.info.id, params: {maxTokens}}, combined, () => undefined);
        if (response.stopReason === "aborted") return {ok: false, kind: "network", code: timeout.aborted ? "timeout" : "cancelled", raw: ""};
        if (response.stopReason === "error") return {ok: false, kind: response.error?.kind ?? "provider", code: response.error?.code ?? null, raw: response.error?.message ?? ""};
        return {ok: true};
    }

    const service: ModelsService = {
        port: (profileDefaults?: (profile: string) => ProfileModelDefaults): ModelPort => ({
            resolve: (query: ModelQuery): ModelResolution => {
                const choice = chooseModel(query, profileDefaults);
                if ("role" in choice) return resolveRole(choice.role);
                if ("selection" in choice) return resolveSelection(choice.selection);
                return resolveReference(choice.reference);
            },
        }),
        snapshot,
        onChange: (listener) => {
            listeners.add(listener);
            return () => void listeners.delete(listener);
        },
    };

    // ---- 模型行的分页读 ----
    const sortKey = (row: MemberRow): [string, string, string] => [row.entry?.group ?? seriesOf(row.id), row.entry?.name ?? row.source?.name ?? row.id, row.id];
    const byMember = (a: MemberRow, b: MemberRow): number => {
        const [ag, an, ai] = sortKey(a);
        const [bg, bn, bi] = sortKey(b);
        return ag === bg ? (an === bn ? (ai < bi ? -1 : ai > bi ? 1 : 0) : an < bn ? -1 : 1) : ag < bg ? -1 : 1;
    };
    const usableMember = (provider: ProviderConfig, row: MemberRow, ready: boolean): boolean => row.entry?.enabled !== false && statusOf(row) === "ok" && ready && effectiveBaseUrl(provider) !== null && effectiveApi(provider) !== null;
    const pageOf = <T>(items: readonly T[], offset: number, limit: number): {page: readonly T[]; nextOffset: number | null} => ({page: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null});

    const remote = (_consumer: ConsumerIdentity): RemoteImplementation<ModelsSettingsContract> => ({
        methods: {
            templates: (_input, ctx) => ctx.ok(listTemplates().map((template) => structuredClone(template) as Template)),
            snapshot: (_input, ctx) => ctx.ok(snapshot()),
            addProvider: (input, ctx) => queue(async () => {
                const template = templateOf(input.template);
                if (template === undefined) return ctx.fail("unknown-template", {detail: `no template ${input.template}`});
                if (!template.addable) return ctx.fail("template-unavailable", {detail: `template ${input.template} cannot be added (${template.reason ?? "unavailable"})`});
                if (input.region !== undefined && !template.regions.some((region) => region.id === input.region)) return ctx.fail("invalid-value", {detail: `template ${input.template} has no region ${input.region}`});
                if (template.blank && (input.name === undefined || input.baseUrl === undefined)) return ctx.fail("invalid-value", {detail: "a blank template needs a name and an address"});
                if (input.baseUrl !== undefined && !validAddress(input.baseUrl)) return ctx.fail("invalid-value", {detail: "the address must be an http or https URL"});
                // 同 id 的遗留密钥（上一个同名服务商没清干净的）先清掉，新服务商不能一出生就带着别人的密钥。
                const id = providerIdFor(input.name ?? template.name, new Set(current().map((item) => item.id)));
                const cleared = await credentialStep(() => credentials.clear(id));
                if (!cleared.ok) return relay(cleared);
                const step = await editProviders<string>((list) => {
                    const taken = new Set(list.map((item) => item.id));
                    const finalId = taken.has(id) ? providerIdFor(input.name ?? template.name, taken) : id;
                    const name = uniqueName(input.name ?? template.name, new Set(list.map((item) => item.name.trim().toLowerCase())));
                    const api = template.blank ? input.api ?? BLANK_API[template.id as BlankTemplate] : input.api;
                    const created: ProviderConfig = {
                        id: finalId, uid: newUid(), template: template.id, name,
                        ...(input.region === undefined ? {} : {region: input.region}),
                        ...(api === undefined ? {} : {api}),
                        ...(input.baseUrl === undefined ? {} : {baseUrl: input.baseUrl}),
                        auth: template.access === "keyless" ? "none" : "default",
                        followSource: !template.blank, excluded: [], models: [],
                    };
                    return {ok: true, value: {next: [...list, created], result: finalId}};
                });
                return step.ok ? ctx.ok({id: step.value}) : relay(step);
            }),
            duplicateProvider: (input, ctx) => queue(async () => {
                const source = current().find((item) => item.id === input.id);
                if (source === undefined) return relay(unknownProvider(input.id));
                const copyKey = source.apiKeyEnv === undefined && source.auth !== "none" ? credentials.get(source.id) : null;
                const step = await editProviders<string>((list) => {
                    const id = providerIdFor(`${source.id}-copy`, new Set(list.map((item) => item.id)));
                    const copy: ProviderConfig = {...structuredClone(source), id, uid: newUid(), name: uniqueName(source.name, new Set(list.map((item) => item.name.trim().toLowerCase())))};
                    return {ok: true, value: {next: [...list, copy], result: id}};
                });
                if (!step.ok) return relay(step);
                const id = step.value;
                // 凭据只复制有效的方式：环境变量引用已随配置复制；库里的密钥复制一行（第二步失败时副本在、密钥没复制，如实交回）。
                if (copyKey === null) return ctx.ok({id});
                const second = await credentialStep(() => credentials.set(id, copyKey));
                if (second.ok) return ctx.ok({id});
                return ctx.fail("partially-applied", {id, key: statusNow(id), detail: "the provider was copied but its API key was not"});
            }),
            updateProvider: (input, ctx) => queue(async () => {
                const step = await withProvider<null>(input.id, (provider, list) => {
                    const {name, region, baseUrl, api, followSource, ...simple} = input.patch;
                    const template = templateOf(provider.template);
                    let next: ProviderConfig = {...provider, ...simple};
                    if (name !== undefined) {
                        if (list.some((item) => item.id !== provider.id && item.name.trim().toLowerCase() === name.trim().toLowerCase())) return failure("invalid-value", `a provider named ${name} already exists`);
                        next.name = name.trim();
                    }
                    if (region === null) delete (next as {region?: string}).region;
                    else if (region !== undefined) {
                        if (!(template?.regions.some((item) => item.id === region) ?? false)) return failure("invalid-value", `template ${provider.template} has no region ${region}`);
                        next.region = region;
                    }
                    if (baseUrl === null) {
                        if (isBlankTemplate(provider.template)) return failure("invalid-value", "a blank template needs an address");
                        delete (next as {baseUrl?: string}).baseUrl;
                    } else if (baseUrl !== undefined) {
                        if (!validAddress(baseUrl)) return failure("invalid-value", "the address must be an http or https URL");
                        next.baseUrl = baseUrl;
                    }
                    if (api === null) {
                        if (isBlankTemplate(provider.template)) next.api = BLANK_API[provider.template as BlankTemplate];
                        else delete (next as {api?: ProviderConfig["api"]}).api;
                    } else if (api !== undefined) next.api = api;
                    if (followSource !== undefined) next = withFollow(next, followSource);
                    if (effectiveApi(next) === null || effectiveBaseUrl(next) === null) return failure("invalid-value", "this protocol has no address in the template; give an address");
                    return {ok: true, value: {provider: next, result: null}};
                });
                return step.ok ? ctx.ok(null) : relay(step);
            }),
            // 删服务商、删模型：先解除角色绑定再删（service.md 输出 15）。两次写入不是一次收口：先解绑的话，后一步失败只留下
            // 未绑定的角色与还在的服务商或模型，重试即可；反过来会留下指向已删模型的绑定。
            removeProvider: (input, ctx) => queue(async () => {
                if (!current().some((provider) => provider.id === input.id)) return relay(unknownProvider(input.id));
                const unbound = await unbind(input.id);
                if (!unbound.ok) return relay(unbound);
                const step = await withProvider<null>(input.id, () => ({ok: true, value: {provider: null, result: null}}));
                if (!step.ok) return relay(step);
                const cleared = await credentialStep(() => credentials.clear(input.id));
                await collectIcons();
                return cleared.ok ? ctx.ok(null) : relay(cleared);
            }),
            setIcon: (input, ctx) => queue(async () => {
                if (!current().some((provider) => provider.id === input.provider)) return relay(unknownProvider(input.provider));
                const rejected = (reason: string, detail: string) => ctx.fail("icon-rejected", {reason, detail});
                let icon: ProviderIcon | undefined;
                if (input.icon !== null && input.icon.kind === "upload") {
                    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(input.icon.png) || input.icon.png.length % 4 !== 0) return rejected("not-png", "the image is not valid base64");
                    const bytes = Buffer.from(input.icon.png, "base64");
                    const checked = checkPng(bytes);
                    if (!checked.ok) return rejected(checked.reason, `the image was rejected (${checked.reason})`);
                    try {
                        // 解码一次确认真能显示：头部合法的文件仍可能是坏的。
                        await new Bun.Image(bytes).png().bytes();
                    } catch {
                        return rejected("undecodable", "the image could not be decoded");
                    }
                    const name = `${createHash("sha256").update(bytes).digest("hex")}.png`;
                    try {
                        await deps.icons.save(name, bytes);
                    } catch (error) {
                        deps.record("warn", "models.icons.write-failed", "Writing a provider icon failed", {error: error instanceof Error ? error.message : String(error)});
                        return rejected("write-failed", "the icon could not be stored");
                    }
                    icon = {kind: "file", name};
                } else if (input.icon !== null) icon = input.icon.kind === "builtin" ? {kind: "builtin", key: input.icon.key} : {kind: "initial"};
                const step = await withProvider<null>(input.provider, (provider) => {
                    const {icon: _old, ...rest} = provider;
                    return {ok: true, value: {provider: icon === undefined ? rest : {...rest, icon}, result: null}};
                });
                // 设置没写成：刚存的文件没有人引用，收掉。
                await collectIcons();
                return step.ok ? ctx.ok(null) : relay(step);
            }),
            providerModels: (input, ctx) => {
                const provider = current().find((item) => item.id === input.provider);
                if (provider === undefined) return ctx.fail("unknown-provider", {detail: `no provider ${input.provider}`});
                const revision = revisionOf(provider, keyStatusOf(provider));
                if (input.revision !== undefined && input.revision !== revision) return ctx.fail("revision-changed", {detail: `${provider.id} changed while its models were being read`});
                const members = (input.scope === "available" ? availableMembers(provider) : listedMembers(provider)).sort(byMember);
                const {page, nextOffset} = pageOf(members, input.offset, input.limit);
                const ready = keyReady(keyStatusOf(provider));
                return ctx.ok({rows: page.map((row) => rowOf(provider, row, ready)), revision, total: members.length, nextOffset});
            },
            enabledModels: (input, ctx) => {
                const scope = current().filter((provider) => input.providers === undefined || input.providers.includes(provider.id));
                const revision = createHash("sha256").update(scope.map((provider) => `${provider.id}:${revisionOf(provider, keyStatusOf(provider))}`).join("|")).digest("hex").slice(0, 16);
                if (input.revision !== undefined && input.revision !== revision) return ctx.fail("revision-changed", {detail: "the model list changed while it was being read"});
                const items = scope.flatMap((provider) => {
                    const ready = keyReady(keyStatusOf(provider));
                    return listedMembers(provider)
                        .filter((row) => (input.usable === true ? usableMember(provider, row, ready) : row.entry?.enabled !== false))
                        .sort(byMember)
                        .map((row) => ({provider, row, ready}));
                });
                const {page, nextOffset} = pageOf(items, input.offset, input.limit);
                return ctx.ok({rows: page.map(({provider, row, ready}) => ({provider: provider.id, ...rowOf(provider, row, ready)})), revision, total: items.length, nextOffset});
            },
            modelsByReference: (input, ctx) => ctx.ok(input.references.map((reference) => {
                const target = splitReference(reference);
                const provider = target === null ? undefined : current().find((item) => item.id === target.provider);
                const row = target === null || provider === undefined ? undefined : findMember(provider, target.model);
                return {reference, provider: provider?.id ?? null, row: provider === undefined || row === undefined ? null : rowOf(provider, row, keyReady(keyStatusOf(provider)))};
            })),
            upsertModel: (input, ctx) => queue(async () => {
                const step = await withProvider<null>(input.provider, (provider) => {
                    const model = storedEntry(provider, input.model);
                    return incomplete(provider, [model]) ?? {ok: true, value: {provider: withAdded(provider, [input.model]), result: null}};
                });
                return step.ok ? ctx.ok(null) : relay(step);
            }),
            removeModel: (input, ctx) => queue(async () => {
                if (!current().some((provider) => provider.id === input.provider)) return relay(unknownProvider(input.provider));
                const unbound = await unbind(input.provider, [input.id]);
                if (!unbound.ok) return relay(unbound);
                const step = await withProvider<null>(input.provider, (provider) => ({ok: true, value: {provider: withRemoved(provider, [input.id]), result: null}}));
                return step.ok ? ctx.ok(null) : relay(step);
            }),
            setModels: (input, ctx) => queue(async () => {
                // 先按当前配置校验（不合格就什么都不动），再解绑要移出的，最后写模型。
                const existing = current().find((provider) => provider.id === input.provider);
                if (existing === undefined) return relay(unknownProvider(input.provider));
                const rejected = incomplete(existing, input.add);
                if (rejected !== null) return relay(rejected);
                const gone = input.remove.filter((id) => !input.add.some((added) => added.id === id));
                const unbound = gone.length === 0 ? {ok: true as const, value: null} : await unbind(input.provider, gone);
                if (!unbound.ok) return relay(unbound);
                const step = await withProvider<null>(input.provider, (provider) => {
                    const next = withAdded(withRemoved(provider, gone), input.add);
                    return incomplete(provider, input.add) ?? {ok: true, value: {provider: next, result: null}};
                });
                return step.ok ? ctx.ok(null) : relay(step);
            }),
            setRole: (input, ctx) => queue(async () => {
                const step = await editRoles<null>((value) => {
                    const role = value.items.find((item) => item.id === input.id);
                    if (role === undefined) return failure("unknown-role", `no role ${input.id}`);
                    const compaction = value.items.find((item) => item.id === MODEL_ROLE_IDS.compaction);
                    // 第一次绑快速档而压缩还没绑：压缩跟着它（输出 14）。
                    const seedCompaction = input.id === MODEL_ROLE_IDS.fast && role.model === null && compaction !== undefined && compaction.model === null && input.model !== undefined && input.model !== null;
                    const items = value.items.map((item) => (item.id === input.id ? patchRole(item, input) : seedCompaction && item.id === MODEL_ROLE_IDS.compaction ? {...item, model: input.model!} : item));
                    return {ok: true, value: {next: {items}, result: null}};
                });
                return step.ok ? ctx.ok(null) : relay(step);
            }),
            addRole: (input, ctx) => queue(async () => {
                const step = await editRoles<string>((value) => {
                    const taken = new Set(value.items.map((item) => item.id));
                    let index = 1;
                    while (taken.has(`custom-${String(index)}`)) index += 1;
                    const id = `custom-${String(index)}`;
                    return {ok: true, value: {next: {items: [...value.items, {id, axis: "specialist", name: input.name, description: input.description, model: null}]}, result: id}};
                });
                return step.ok ? ctx.ok({id: step.value}) : relay(step);
            }),
            updateRole: (input, ctx) => queue(async () => {
                if (BUILTIN.has(input.id)) return ctx.fail("builtin-role", {detail: `${input.id} is a built-in role`});
                const step = await editRoles<null>((value) => {
                    if (!value.items.some((item) => item.id === input.id)) return failure("unknown-role", `no role ${input.id}`);
                    return {ok: true, value: {next: {items: value.items.map((item) => (item.id === input.id ? {...item, name: input.name, description: input.description} : item))}, result: null}};
                });
                return step.ok ? ctx.ok(null) : relay(step);
            }),
            removeRole: (input, ctx) => queue(async () => {
                if (BUILTIN.has(input.id)) return ctx.fail("builtin-role", {detail: `${input.id} is a built-in role`});
                const step = await editRoles<null>((value) => {
                    if (!value.items.some((item) => item.id === input.id)) return failure("unknown-role", `no role ${input.id}`);
                    return {ok: true, value: {next: {items: value.items.filter((item) => item.id !== input.id)}, result: null}};
                });
                return step.ok ? ctx.ok(null) : relay(step);
            }),
            setKey: (input, ctx) => queue(async () => {
                if (!providers().some((item) => item.id === input.provider)) return ctx.fail("unknown-provider", {detail: `no provider ${input.provider}`});
                if (input.value.startsWith("env:")) {
                    const name = envRefName(input.value);
                    if (name === null) return ctx.fail("invalid-value", {detail: "env: must be followed by an environment variable name"});
                    // apiKeyEnv 盖过库里的密钥：先写它，第二步失败时生效的已经是新的那个（输出 13）。
                    const first = await setApiKeyEnv(input.provider, name);
                    if (!first.ok) return relay(first);
                    const second = await credentialStep(() => credentials.clear(input.provider));
                    return second.ok ? ctx.ok(statusNow(input.provider)) : relay(partial(input.provider, second));
                }
                const first = await credentialStep(() => credentials.set(input.provider, input.value));
                if (!first.ok) return relay(first);
                if (providers().find((item) => item.id === input.provider)?.apiKeyEnv === undefined) return ctx.ok(statusNow(input.provider));
                const second = await setApiKeyEnv(input.provider, undefined);
                return second.ok ? ctx.ok(statusNow(input.provider)) : relay(partial(input.provider, second as Failure));
            }),
            clearKey: (input, ctx) => queue(async () => {
                if (!providers().some((item) => item.id === input.provider)) return ctx.fail("unknown-provider", {detail: `no provider ${input.provider}`});
                const first = await credentialStep(() => credentials.clear(input.provider));
                if (!first.ok) return relay(first);
                if (providers().find((item) => item.id === input.provider)?.apiKeyEnv === undefined) return ctx.ok(statusNow(input.provider));
                const second = await setApiKeyEnv(input.provider, undefined);
                return second.ok ? ctx.ok(statusNow(input.provider)) : relay(partial(input.provider, second as Failure));
            }),
            discover: async (input, ctx) => {
                const provider = current().find((item) => item.id === input.provider);
                if (provider === undefined) return ctx.fail("unknown-provider", {detail: `no provider ${input.provider}`});
                const api = effectiveApi(provider);
                const baseUrl = effectiveBaseUrl(provider);
                if (baseUrl === null || (api !== "openai-completions" && api !== "openai-responses")) return ctx.fail("not-supported", {detail: "only OpenAI compatible endpoints list their models"});
                const auth = requestAuth(targetOf(provider), null, access);
                if (auth.missing.length > 0 || (auth.key === null && provider.auth !== "none")) return ctx.fail("no-credentials", {detail: "no credential for this provider"});
                const result = await discoverModels({api, baseUrl, ...(provider.auth === "none" || auth.key === null ? {} : {apiKey: auth.key}), headers: auth.headers, signal: ctx.signal});
                switch (result.state) {
                    case "found":
                        return ctx.ok(result.models.map((model) => ({id: model.id, name: model.name, suggested: model.suggested === null ? null : {contextWindow: model.suggested.contextWindow, maxOutput: model.suggested.maxTokens, vision: model.suggested.images, reasoning: model.suggested.reasoning}})));
                    case "empty":
                        return ctx.ok([]);
                    case "not_supported":
                        return ctx.fail("not-supported", {detail: `the endpoint answered ${String(result.status)}`});
                    case "auth":
                        return ctx.fail("auth", {detail: `the endpoint answered ${String(result.status)}`});
                    case "unreachable":
                        return ctx.fail("unreachable", {detail: result.message});
                    case "failed":
                        return ctx.fail("failed", {detail: result.message});
                }
            },
            check: async (input, ctx) => {
                const provider = current().find((item) => item.id === input.provider);
                if (provider === undefined) return ctx.fail("unknown-provider", {detail: `no provider ${input.provider}`});
                const row = findMember(provider, input.model);
                if (row === undefined) return ctx.fail("unknown-model", {detail: `no model ${input.model}`});
                return ctx.ok(await check(provider, row, ctx.signal));
            },
            checkAll: async (input, ctx) => {
                const provider = current().find((item) => item.id === input.provider);
                if (provider === undefined) return ctx.fail("unknown-provider", {detail: `no provider ${input.provider}`});
                const members = listedMembers(provider).filter((row) => row.entry?.enabled !== false).sort(byMember);
                const pending = [...members];
                const results: {model: string; result: CheckResult}[] = [];
                const worker = async (): Promise<void> => {
                    for (let next = pending.shift(); next !== undefined; next = pending.shift()) results.push({model: next.id, result: await check(provider, next, ctx.signal)});
                };
                await Promise.all(Array.from({length: Math.min(CHECK_CONCURRENCY, pending.length)}, worker));
                const order = members.map((row) => row.id);
                return ctx.ok(results.sort((a, b) => order.indexOf(a.model) - order.indexOf(b.model)));
            },
        },
        events: {changed},
    });

    return {
        service,
        remote,
        close: async () => {
            offConfig();
            offCredentials();
            listeners.clear();
            await tail;
        },
    };
}
