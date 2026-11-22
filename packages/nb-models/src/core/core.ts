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
import {buildResolution, envRefName, envValue, listingFlavor, listingHeaders, requestAuth, templateRoutes} from "@notnotype/nb-harness/models";
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
import {availableMembers, findMember, listedMembers, windowOf} from "./members";
import type {MemberRow, MemberSources, SourceModel} from "./members";
import {createSources} from "./sources";
import type {SourceStore} from "./sources";
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
    /** 模型列表与在线目录的本地文件；不给时只在内存里（重启后重新拉）。 */
    readonly sources?: SourceStore;
    /** 时钟（毫秒）；缺省 `Date.now`。来源的“超过一天”按它算。 */
    readonly now?: () => number;
    /** 在线目录的地址；缺省用 stencil 的（测试给本机端点）。 */
    readonly catalogUrl?: string;
    /** 诊断；事件名见各处 `record` 的调用（`models.catalog.*`、`models.sources.*`、`models.credentials.failed` 等）。 */
    readonly record: (level: "info" | "warn", event: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

export interface ModelsCore {
    readonly service: ModelsService;
    /**
     * 读来源缓存与在线目录、回收孤立文件，自动更新开着时在后台拉过期的（docs/specs/models/service.md“模型来源”）。应用在交出服务之前
     * 等它；不调用时成员只来自打包目录，也不会自己出站（手动的重新拉取照常受理）。
     */
    start(): Promise<void>;
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

/** 类型不明的模型里，id 带这些词的不自动启用（向量、重排、语音、审核这类模型常混在 `/models` 里）。 */
const NON_CHAT_ID = /embed|rerank|whisper|tts|moderation/iu;

/** 写入设置的整份服务商值的帧字节上限（RPC 单帧 1 MiB，留余量）：按 JSON 转义后的字节算。 */
const SETTINGS_FRAME_LIMIT = 768 * 1024;
/** 一页模型行编码后的上限：给 RPC 信封与转义留出余量。 */
const PAGE_BYTES = 512 * 1024;

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
        sourcesCache.clear();
        const next = snapshot();
        for (const listener of [...listeners]) listener();
        changed.emit(next);
    };
    const offConfig = config.onChange((keys) => {
        invalidate();
        if (keys.has("autoUpdate")) sources.autoUpdateChanged();
    });
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
            // 手加的模型没有目录行可借协议：没覆盖时用模板的缺省协议（读行的 `usable` 也按它算，两边一致）。
            ...(isBlankTemplate(provider.template) || defaultApi(provider.template) === null ? {} : {defaultApi: defaultApi(provider.template)!}),
            ...(baseUrl === undefined ? {} : {baseUrl}),
            ...(provider.apiKeyEnv === undefined ? {} : {apiKeyEnv: provider.apiKeyEnv}),
            ...(provider.headers === undefined ? {} : {headers: provider.headers}),
        };
    };
    /**
     * 解析用的模型配置：用户的覆盖在上；来源有目录行时交给 nb-harness 物化，只来自列表的模型（目录里没有）把列表给的窗口、上限与看图
     * 当作没覆盖时的值。
     */
    const modelTargetOf = (id: string, entry: ModelConfig | undefined, source: SourceModel | undefined): ModelTarget => {
        const listed = source !== undefined && source.row === undefined ? source : undefined;
        const contextWindow = entry?.contextWindow ?? listed?.contextWindow ?? undefined;
        const maxOutput = entry?.maxOutput ?? listed?.maxTokens ?? undefined;
        const vision = entry?.vision ?? (listed === undefined ? undefined : listed.images);
        const name = entry?.name ?? (listed === undefined || listed.name === id ? undefined : listed.name);
        return {
        id,
        ...(entry?.origin === "manual" ? {manual: true} : {}),
        ...(source?.row === undefined || entry?.origin === "manual" ? {} : {row: source.row}),
        ...(name === undefined ? {} : {name}),
        ...(contextWindow === undefined ? {} : {contextWindow}),
        ...(maxOutput === undefined ? {} : {maxOutput}),
        ...(vision === undefined ? {} : {vision}),
        ...(entry?.reasoning === undefined ? {} : {reasoning: entry.reasoning}),
        // 触发点要等窗口知道了才算得出；全局设置每次现读，设置改了从下一次解析起生效。
        compactAtFor: (contextWindow) => compactionTrigger(effectiveCompaction(entry ?? {}, config.compaction()), contextWindow),
        ...(entry?.price === undefined ? {} : {price: entry.price}),
        ...(entry?.headers === undefined ? {} : {headers: entry.headers}),
        };
    };
    const secret = typeof deps.secret === "string" ? deps.secret : Buffer.from(deps.secret);
    /** 签名绑定凭据的协议另带凭据身份；OpenAI 兼容的对话没有签名。 */
    const signsWithCredential = (api: WireApi): boolean => api !== "openai-completions";
    /** 认证用到的全部输入：密钥与生效的请求头（自定义的 `Authorization` 这类头能盖过密钥，换了它也是换了账号）。 */
    const authInput = (key: string | null, headers: Readonly<Record<string, string>>): string => JSON.stringify([key, Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))]);
    /**
     * 部署身份：实例的 `uid` 加有效地址与协议；同名重建（新 `uid`）、换地址与协议后都不同，旧日志的签名不再还原。凭据身份是认证输入
     * （密钥与请求头）的 HMAC：换了其中任何一样，旧签名也不再还原。
     */
    const identityOf = (provider: ProviderConfig) => (effective: {readonly api: WireApi; readonly baseUrl: string; readonly key: string | null; readonly headers: Readonly<Record<string, string>>}) => ({
        deployment: createHash("sha256").update(`${provider.uid}\n${effective.api}\n${effective.baseUrl}`).digest("hex").slice(0, 32),
        ...(signsWithCredential(effective.api) && (effective.key !== null || Object.keys(effective.headers).length > 0) ? {credential: createHmac("sha256", secret).update(authInput(effective.key, effective.headers)).digest("hex").slice(0, 32)} : {}),
        legacyProvider: provider.id,
    });
    /**
     * 解析之后实例被改了（地址、协议、认证方式、`uid`）或认证输入换了（密钥、服务商与模型的请求头），旧解析不能再发（防止新的认证
     * 发往旧地址，或旧解析带着旧认证继续发）。
     */
    const stillCurrentFor = (provider: ProviderConfig, modelId: string) => {
        const fingerprint = (item: ProviderConfig): string => {
            const auth = requestAuth(targetOf(item), {headers: findMember(item, sourcesFor(item), modelId)?.entry?.headers ?? {}}, access);
            return JSON.stringify([item.uid, effectiveApi(item), effectiveBaseUrl(item), item.auth, item.apiKeyEnv ?? null, follows(item), authInput(auth.key, auth.headers)]);
        };
        const resolvedWith = fingerprint(provider);
        return (): boolean => {
            const now = current().find((item) => item.uid === provider.uid);
            return now !== undefined && fingerprint(now) === resolvedWith;
        };
    };
    // ---- 模型来源 ----
    /**
     * 列表请求的部署与凭据身份（`sources.ts` 的两层有效性）：部署是 `uid`、列表变体、有效协议与地址的哈希；凭据是认证输入的 HMAC，
     * 与会话日志的凭据身份同一种算法。没有可用的凭据（要密钥却没有、请求头引用的变量没有值）时不发请求。
     */
    const deploymentOf = (provider: ProviderConfig) => {
        const api = effectiveApi(provider);
        const baseUrl = effectiveBaseUrl(provider);
        if (api === null || baseUrl === null) return null;
        const blank = isBlankTemplate(provider.template);
        const flavor = listingFlavor(api, blank ? null : provider.template);
        const auth = requestAuth(targetOf(provider), null, access);
        const key = provider.auth === "none" ? null : auth.key;
        const ready = auth.missing.length === 0 && (key !== null || provider.auth === "none");
        return {
            deployment: createHash("sha256").update(`${provider.uid}\n${flavor}\n${api}\n${baseUrl}`).digest("hex").slice(0, 32),
            credential: createHmac("sha256", secret).update(authInput(key, auth.headers)).digest("hex").slice(0, 32),
            request: ready ? {flavor, baseUrl, headers: listingHeaders(flavor, key, auth.headers, follows(provider))} : null,
        };
    };
    const sources = createSources({
        ...(deps.sources === undefined ? {} : {store: deps.sources}),
        ...(deps.catalogUrl === undefined ? {} : {catalogUrl: deps.catalogUrl}),
        now: deps.now ?? Date.now,
        record: deps.record,
        autoUpdate: () => config.autoUpdate(),
        providers: current,
        confirmed: () => config.providers.editable().status === "ok",
        deploymentOf,
        changed: () => invalidate(),
    });
    /**
     * 一家此刻的来源模型（成员规则见 `members.ts`）。有这个部署的列表时按列表：列表自己说了类型的照它；没说的、模板不是空白的，查目录里
     * 同 id 的行（不是对话模型的丢掉）；仍不明的是 `unknown`，只有空白模板里 id 不像向量或语音模型的才自动加入（决定 27；没有窗口的
     * 照样列出，状态为待补字段）。
     * 没有列表时用目录里模板的对话模型（空白模板没有）。按部署与来源版本缓存，快照作废时清空。
     */
    const sourcesCache = new Map<string, MemberSources>();
    const sourcesFor = (provider: ProviderConfig): MemberSources => {
        const api = effectiveApi(provider);
        const baseUrl = effectiveBaseUrl(provider);
        const cacheKey = `${provider.uid}\n${provider.template}\n${api ?? ""}\n${baseUrl ?? ""}\n${sources.rowsVersion(provider)}`;
        const cached = sourcesCache.get(cacheKey);
        if (cached !== undefined) return cached;
        const view = sources.view();
        const blank = isBlankTemplate(provider.template);
        const models = new Map<string, SourceModel>();
        const listing = sources.listing(provider);
        if (listing === null) {
            if (!blank) for (const model of view.chatModels(provider.template)) models.set(model.id, {...model, kind: "chat", auto: true, ...catalogRowOf(view.find(provider.template, model.id))});
        } else {
            for (const listed of listing) {
                const found = blank ? undefined : view.find(provider.template, listed.id);
                const catalogChat = found === undefined ? null : found.info.chat && found.info.wire !== null;
                const kind = listed.kind !== "unknown" ? listed.kind : catalogChat === null ? "unknown" : catalogChat ? "chat" : "other";
                if (kind === "other") continue;
                if (found !== undefined && catalogChat === true) {
                    models.set(listed.id, {...found.info, kind, auto: true, row: {model: found.model, priceKnown: found.priceKnown}});
                    continue;
                }
                const contextWindow = listed.contextWindow ?? null;
                // 空白模板里类型不明的：像向量、语音模型的不自动加入；其余加入，没有窗口的状态是 incomplete（待补字段，不能用）。
                const auto = kind === "chat" || (blank && !NON_CHAT_ID.test(listed.id));
                models.set(listed.id, {
                    id: listed.id, name: listed.name ?? listed.id, api: api ?? "openai-completions", wire: api, chat: true, baseUrl: baseUrl ?? "",
                    contextWindow, maxTokens: listed.maxOutput ?? null, reasoning: false, efforts: [], images: listed.vision ?? false, price: null,
                    kind, auto,
                });
            }
        }
        const value: MemberSources = {models, unsendable: (id) => (blank ? null : view.unsendable(provider.template, id))};
        sourcesCache.set(cacheKey, value);
        return value;
    };
    const catalogRowOf = (found: ReturnType<ReturnType<typeof sources.view>["find"]>): {row?: SourceModel["row"]} => (found === undefined ? {} : {row: {model: found.model, priceKnown: found.priceKnown}});
    /** 一个服务商的版本号：配置、密钥状态或来源变了就变，调用方据此判断自己读到的行是否还新。 */
    const revisionOf = (provider: ProviderConfig, key: KeyStatus): string => Bun.hash(JSON.stringify([provider, key, sources.rowsVersion(provider)])).toString(36);

    const build = (provider: ProviderConfig, row: MemberRow) => buildResolution(targetOf(provider), modelTargetOf(row.id, row.entry, row.source), access, {transport, identityOf: identityOf(provider), stillCurrent: stillCurrentFor(provider, row.id)});

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
            const row = target === null || provider === undefined ? undefined : findMember(provider, sourcesFor(provider), target.model);
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
    /**
     * `unsupported`：来源条目在目录里有，但不能当对话模型发（不是对话类，或传输不走 HTTP 请求，例如 v1 留下的 Bedrock、Cursor）；
     * `missing`：设置里是来源模型、目录里已经没有；`incomplete`：上下文窗口不明（目录没给、也没填）。
     */
    const statusOf = (row: MemberRow): ModelRow["status"] => (row.unsendable !== null ? "unsupported" : row.origin === "source" && row.source === undefined ? "missing" : windowOf(row) === null ? "incomplete" : "ok");

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
            kind: row.source?.kind ?? "chat",
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
            source: overridden.length === 0 || source === undefined ? null : {name: source.name, contextWindow: source.contextWindow, maxOutput: source.maxTokens, vision: source.images, reasoning: source.reasoning, price: sourcePriceOf(source)},
        };
        rowCache.set(cacheKey, value);
        return value;
    };

    // ---- 快照 ----
    let missingReported = new Set<string>();
    function snapshot(): ModelsSnapshot {
        if (snapshotCache !== null) return snapshotCache;
        const list: SnapshotProvider[] = current().map((provider) => {
            const members = listedMembers(provider, sourcesFor(provider));
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
                source: sources.state(provider),
                modelCount: members.length,
                enabledCount: members.filter((row) => row.entry?.enabled !== false).length,
                excludedCount: provider.excluded.length,
                modelsRevision: revisionOf(provider, key),
            };
        });
        // 目录漂移（输出 9）：设置里引用的来源模型不在目录里了，每个只诊断一次。
        const missing = new Set(current().flatMap((provider) => listedMembers(provider, sourcesFor(provider)).filter((row) => statusOf(row) === "missing").map((row) => referenceOf(provider.id, row.id))));
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
            // 设置写盘时整份文本还要作为字符串再编码一层进 RPC 帧：按两层转义后的字节核对，给其它设置项与信封留出余量。
            if (Buffer.byteLength(JSON.stringify(JSON.stringify(step.value.next))) > SETTINGS_FRAME_LIMIT) return failure("invalid-value", "the providers setting would exceed the 768 KiB limit; remove models or providers first");
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
        const previous = provider.models.find((item) => item.id === model.id);
        const manual = (model.origin ?? previous?.origin) === "manual";
        const source = manual ? undefined : sourcesFor(provider).models.get(model.id);
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
        const sources = sourcesFor(provider).models;
        // 手加的模型不借目录的窗口（目录里恰好有同 id 的也一样）。
        const bad = models.find((model) => model.enabled && missingContextWindow(model, model.origin === "manual" ? null : sources.get(model.id)?.contextWindow ?? null));
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
        const sources = sourcesFor(provider).models;
        const gone = new Set(ids);
        const manual = new Set(provider.models.filter((entry) => entry.origin === "manual").map((entry) => entry.id));
        return {...provider, excluded: [...new Set([...provider.excluded, ...ids.filter((id) => sources.has(id) && !manual.has(id))])], models: provider.models.filter((entry) => !gone.has(entry.id))};
    };
    /** 打开或关闭“自动加入”：关的时候给此刻有效、还没有条目的来源成员补冻结条目；开的时候只删仍是纯冻结的条目，用户改过的去掉冻结标记。 */
    const withFollow = (provider: ProviderConfig, follow: boolean): ProviderConfig => {
        if (provider.followSource === follow) return provider;
        if (!follow) {
            const entries = new Set(provider.models.map((entry) => entry.id));
            const frozen: ModelConfig[] = listedMembers(provider, sourcesFor(provider)).filter((row) => row.source !== undefined && !entries.has(row.id)).map((row) => ({id: row.id, origin: "source", enabled: true, frozen: true}));
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

    /**
     * 新建一份服务商（添加、复制）：先清掉凭据库里这个 id 的遗留密钥（上一个同名服务商没清干净的），再写设置，新服务商不能一出生就
     * 带着别人的密钥。写的时候这个 id 已经被别处占了（设置冲突后重读到的），换下一个 id 重来，清的始终是最后真正用的那个。
     */
    const createProvider = async (base: string, make: (id: string, list: readonly ProviderConfig[]) => ProviderConfig): Promise<Step<string>> => {
        for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
            const id = providerIdFor(base, new Set(current().map((item) => item.id)));
            const cleared = await credentialStep(() => credentials.clear(id));
            if (!cleared.ok) return cleared;
            let taken = false;
            const step = await editProviders<string>((list) => {
                if (list.some((item) => item.id === id)) {
                    taken = true;
                    return failure("write-conflict", `provider id ${id} was taken meanwhile`);
                }
                return {ok: true, value: {next: [...list, make(id, list)], result: id}};
            });
            if (!taken) return step;
            await changeOf("providers");
        }
        return failure("write-conflict", "the provider list kept changing while adding");
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
    /**
     * 一页：至多 `limit` 行，且编码后不超过 `PAGE_BYTES`（RPC 单帧 1 MiB；行里有用户写的 id、名称与请求头，只按行数截保证不了帧大小）。
     * 至少给一行（单行受设置的帧预算约束，不会超过一帧）；截短时 `nextOffset` 接着这页实际交出的最后一行。
     */
    const pageOf = <T, R>(items: readonly T[], offset: number, limit: number, toRow: (item: T) => R): {page: R[]; nextOffset: number | null} => {
        const page: R[] = [];
        let bytes = 0;
        for (let at = offset; at < Math.min(items.length, offset + limit); at += 1) {
            const row = toRow(items[at]!);
            const size = Buffer.byteLength(JSON.stringify(row));
            if (page.length > 0 && bytes + size > PAGE_BYTES) break;
            page.push(row);
            bytes += size;
        }
        const next = offset + page.length;
        return {page, nextOffset: next < items.length ? next : null};
    };

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
                const api = template.blank ? input.api ?? BLANK_API[template.id as BlankTemplate] : input.api;
                const draft = (id: string, list: readonly ProviderConfig[]): ProviderConfig => ({
                    id, uid: newUid(), template: template.id,
                    name: uniqueName(input.name ?? template.name, new Set(list.map((item) => item.name.trim().toLowerCase()))),
                    ...(input.region === undefined ? {} : {region: input.region}),
                    ...(api === undefined ? {} : {api}),
                    ...(input.baseUrl === undefined ? {} : {baseUrl: input.baseUrl}),
                    auth: template.access === "keyless" ? "none" : "default",
                    followSource: true, excluded: [], models: [],
                });
                // 与改协议同一条：选的协议在模板里没有地址、又没给地址的，建出来也发不了。
                const probe = draft("probe", current());
                if (effectiveApi(probe) === null || effectiveBaseUrl(probe) === null) return ctx.fail("invalid-value", {detail: "this protocol has no address in the template; give an address"});
                const step = await createProvider(input.name ?? template.name, draft);
                if (!step.ok) return relay(step);
                const created = current().find((item) => item.id === step.value);
                if (created !== undefined) sources.refresh(created, "implicit");
                return ctx.ok({id: step.value});
            }),
            duplicateProvider: (input, ctx) => queue(async () => {
                const source = current().find((item) => item.id === input.id);
                if (source === undefined) return relay(unknownProvider(input.id));
                const copyKey = source.apiKeyEnv === undefined && source.auth !== "none" ? credentials.get(source.id) : null;
                const step = await createProvider(`${source.id}-copy`, (id, list) => ({...structuredClone(source), id, uid: newUid(), name: uniqueName(source.name, new Set(list.map((item) => item.name.trim().toLowerCase())))}));
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
                await sources.collect();
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
                const members = (input.scope === "available" ? availableMembers(provider, sourcesFor(provider)) : listedMembers(provider, sourcesFor(provider))).sort(byMember);
                const ready = keyReady(keyStatusOf(provider));
                const {page, nextOffset} = pageOf(members, input.offset, input.limit, (row) => rowOf(provider, row, ready));
                return ctx.ok({rows: page, revision, total: members.length, nextOffset});
            },
            enabledModels: (input, ctx) => {
                const scope = current().filter((provider) => input.providers === undefined || input.providers.includes(provider.id));
                const revision = createHash("sha256").update(scope.map((provider) => `${provider.id}:${revisionOf(provider, keyStatusOf(provider))}`).join("|")).digest("hex").slice(0, 16);
                if (input.revision !== undefined && input.revision !== revision) return ctx.fail("revision-changed", {detail: "the model list changed while it was being read"});
                const items = scope.flatMap((provider) => {
                    const ready = keyReady(keyStatusOf(provider));
                    return listedMembers(provider, sourcesFor(provider))
                        .filter((row) => (input.usable === true ? usableMember(provider, row, ready) : row.entry?.enabled !== false))
                        .sort(byMember)
                        .map((row) => ({provider, row, ready}));
                });
                const {page, nextOffset} = pageOf(items, input.offset, input.limit, ({provider, row, ready}) => ({provider: provider.id, ...rowOf(provider, row, ready)}));
                return ctx.ok({rows: page, revision, total: items.length, nextOffset});
            },
            modelsByReference: (input, ctx) => ctx.ok(input.references.map((reference) => {
                const target = splitReference(reference);
                const provider = target === null ? undefined : current().find((item) => item.id === target.provider);
                const row = target === null || provider === undefined ? undefined : findMember(provider, sourcesFor(provider), target.model);
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
                const outcome = await (async () => {
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
                })();
                // 用户给了新凭据：跟着拉一次列表（凭据变了的旧列表不会自己更新）。
                const provider = outcome.ok ? current().find((item) => item.id === input.provider) : undefined;
                if (provider !== undefined) sources.refresh(provider, "implicit");
                return outcome;
            }),
            clearKey: (input, ctx) => queue(async () => {
                if (!providers().some((item) => item.id === input.provider)) return ctx.fail("unknown-provider", {detail: `no provider ${input.provider}`});
                const first = await credentialStep(() => credentials.clear(input.provider));
                if (!first.ok) return relay(first);
                if (providers().find((item) => item.id === input.provider)?.apiKeyEnv === undefined) return ctx.ok(statusNow(input.provider));
                const second = await setApiKeyEnv(input.provider, undefined);
                return second.ok ? ctx.ok(statusNow(input.provider)) : relay(partial(input.provider, second as Failure));
            }),
            refreshSource: (input, ctx) => {
                const provider = current().find((item) => item.id === input.provider);
                if (provider === undefined) return ctx.fail("unknown-provider", {detail: `no provider ${input.provider}`});
                return sources.refresh(provider, "user") === "accepted" ? ctx.ok(null) : ctx.fail("no-credentials", {detail: "no credential for this provider"});
            },
            check: async (input, ctx) => {
                const provider = current().find((item) => item.id === input.provider);
                if (provider === undefined) return ctx.fail("unknown-provider", {detail: `no provider ${input.provider}`});
                const row = findMember(provider, sourcesFor(provider), input.model);
                if (row === undefined) return ctx.fail("unknown-model", {detail: `no model ${input.model}`});
                return ctx.ok(await check(provider, row, ctx.signal));
            },
            checkAll: async (input, ctx) => {
                const provider = current().find((item) => item.id === input.provider);
                if (provider === undefined) return ctx.fail("unknown-provider", {detail: `no provider ${input.provider}`});
                const members = listedMembers(provider, sourcesFor(provider)).filter((row) => row.entry?.enabled !== false).sort(byMember);
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
        start: () => sources.start(),
        close: async () => {
            await sources.close();
            offConfig();
            offCredentials();
            listeners.clear();
            await tail;
        },
    };
}
