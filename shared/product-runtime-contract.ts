import {createHash} from "node:crypto";
import {readFile, stat} from "node:fs/promises";
import {isAbsolute, posix, resolve, win32} from "node:path";

export const PRODUCT_RUNTIME_CONTRACT_PATH = "server/runtime-contract.json";
export const PRODUCT_RUNTIME_COMMAND_BOOTSTRAP = "server/commands/product-command.mjs";
/** Product Runtime 禁止 Bun 在缺包时联网或从全局 cache 隐式补装依赖。 */
export const PRODUCT_BUN_RUNTIME_ARGS = ["--no-install", "--no-env-file"] as const;
export const PRODUCT_RUNTIME_CONTRACT_SCHEMA = "nbook.product-runtime-contract/v5";
export const PRODUCT_RUNTIME_PREVIOUS_CONTRACT_SCHEMA = "nbook.product-runtime-contract/v4";
export const PRODUCT_SHUTDOWN_PROTOCOL = "http-loopback-token/v1";
export const PRODUCT_SHUTDOWN_PATH = "/__nbook/control/shutdown";
export const PRODUCT_SHUTDOWN_TIMEOUT_MS = 30_000;
export const PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT = "NEURO_BOOK_SHUTDOWN_TOKEN";
export const PRODUCT_STARTUP_NONCE_ENVIRONMENT = "NEURO_BOOK_STARTUP_NONCE";
export const PRODUCT_STARTUP_READY_PATH = "/api/app/version";
export const PRODUCT_MANAGER_VERIFICATION_PROTOCOL = "runtime-image-receipt/v1";
/** Product 丢失 Agent Session Store runtime lease；Manager据此给出可操作提示。 */
export const PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED = 75;

export const PRODUCT_RUNTIME_COMMAND_IDS = [
    "start",
    "migrate-database",
    "migrate-application-state",
    "create-admin",
    "profile",
    "variable",
    "workspace",
] as const;

/** Workspace CLI 的相对文件参数属于调用方语义，必须保留 invocation cwd。 */
export const PRODUCT_RUNTIME_INVOCATION_CWD_COMMAND_IDS = [
    "workspace",
] as const satisfies readonly ProductRuntimeCommandId[];

export const PRODUCT_RUNTIME_INTERNAL_IDS = [
    "prepare-system-assets",
    "check-migrations",
] as const;

export const PRODUCT_RUNTIME_CHECK_IDS = [
    "profile-compile",
    "variable-authoring",
    "sqlite-vec",
    "sharp-image-variant",
    "application-state",
    "workspace-cli",
    "web-fetch",
    "world-engine-config",
] as const;

export type ProductRuntimeCommandId = typeof PRODUCT_RUNTIME_COMMAND_IDS[number];
export type ProductRuntimeInternalId = typeof PRODUCT_RUNTIME_INTERNAL_IDS[number];
export type ProductRuntimeCheckId = typeof PRODUCT_RUNTIME_CHECK_IDS[number];
export type ProductRuntimeLaunchMode = "command" | "check";

export type ProductRuntimeInvocation = {
    entry: string;
    fixedArgs: string[];
    allowAdditionalArgs: boolean;
};

export type ProductRuntimeContract = {
    schema: typeof PRODUCT_RUNTIME_CONTRACT_SCHEMA;
    commands: Record<ProductRuntimeCommandId, ProductRuntimeInvocation>;
    internal: Record<ProductRuntimeInternalId, ProductRuntimeInvocation>;
    checks: Record<ProductRuntimeCheckId, ProductRuntimeInvocation>;
    shutdown: {
        protocol: typeof PRODUCT_SHUTDOWN_PROTOCOL;
        path: typeof PRODUCT_SHUTDOWN_PATH;
        timeoutMs: typeof PRODUCT_SHUTDOWN_TIMEOUT_MS;
        tokenEnvironment: typeof PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT;
    };
    startup: {
        nonceEnvironment: typeof PRODUCT_STARTUP_NONCE_ENVIRONMENT;
        readyPath: typeof PRODUCT_STARTUP_READY_PATH;
        managerVerification: typeof PRODUCT_MANAGER_VERIFICATION_PROTOCOL;
    };
};

/** 只供 Manager 验证已安装旧镜像；新建候选和 Product bootstrap 不接受此版本。 */
export type PreviousProductRuntimeContract = Omit<ProductRuntimeContract, "schema" | "startup"> & {
    schema: typeof PRODUCT_RUNTIME_PREVIOUS_CONTRACT_SCHEMA;
};

export type ParsedProductRuntimeContract = ProductRuntimeContract | PreviousProductRuntimeContract;

export type ProductRuntimeEntryMap = Readonly<{
    productStart: string;
    sqliteMigrate: string;
    applicationStateMigration: string;
    createAdmin: string;
    profile: string;
    variable: string;
    workspace: string;
    prepareSystemAssets: string;
    checkMigrations: string;
    profileAuthoringSmoke: string;
    variableAuthoringSmoke: string;
    imageVariantSmoke: string;
    sqliteVecSmoke: string;
    webFetchSmoke: string;
    worldEngineConfigSmoke: string;
}>;

/** 从本次 bundle 的实际 entry 输出建立唯一 Product 运行合同。 */
export function createProductRuntimeContract(entries: ProductRuntimeEntryMap): ProductRuntimeContract {
    const command = (entry: string, fixedArgs: string[] = [], allowAdditionalArgs = false): ProductRuntimeInvocation => ({
        entry,
        fixedArgs,
        allowAdditionalArgs,
    });
    return {
        schema: PRODUCT_RUNTIME_CONTRACT_SCHEMA,
        commands: {
            start: command(entries.productStart),
            "migrate-database": command(entries.sqliteMigrate, ["--deploy"]),
            "migrate-application-state": command(entries.applicationStateMigration, [], true),
            "create-admin": command(entries.createAdmin, [], true),
            profile: command(entries.profile, [], true),
            variable: command(entries.variable, [], true),
            workspace: command(entries.workspace, [], true),
        },
        internal: {
            "prepare-system-assets": command(entries.prepareSystemAssets, ["--sync-user-assets"]),
            "check-migrations": command(entries.checkMigrations),
        },
        checks: {
            "profile-compile": command(entries.profileAuthoringSmoke),
            "variable-authoring": command(entries.variableAuthoringSmoke),
            "sqlite-vec": command(entries.sqliteVecSmoke),
            "sharp-image-variant": command(entries.imageVariantSmoke),
            "application-state": command(entries.applicationStateMigration, ["--plan"]),
            "workspace-cli": command(entries.workspace, ["node", "schema", "--json"]),
            "web-fetch": command(entries.webFetchSmoke),
            "world-engine-config": command(entries.worldEngineConfigSmoke),
        },
        shutdown: {
            protocol: PRODUCT_SHUTDOWN_PROTOCOL,
            path: PRODUCT_SHUTDOWN_PATH,
            timeoutMs: PRODUCT_SHUTDOWN_TIMEOUT_MS,
            tokenEnvironment: PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT,
        },
        startup: {
            nonceEnvironment: PRODUCT_STARTUP_NONCE_ENVIRONMENT,
            readyPath: PRODUCT_STARTUP_READY_PATH,
            managerVerification: PRODUCT_MANAGER_VERIFICATION_PROTOCOL,
        },
    };
}

/** 严格解析磁盘中的 Product Runtime Contract，不接受未知字段或缺失命令。 */
export function parseProductRuntimeContract(value: unknown): ProductRuntimeContract;
export function parseProductRuntimeContract(value: unknown, options: {allowPrevious: true}): ParsedProductRuntimeContract;
export function parseProductRuntimeContract(
    value: unknown,
    options: {allowPrevious?: boolean} = {},
): ParsedProductRuntimeContract {
    const root = object(value, "Product Runtime Contract");
    const schema = root.schema;
    const isCurrent = schema === PRODUCT_RUNTIME_CONTRACT_SCHEMA;
    const isPrevious = schema === PRODUCT_RUNTIME_PREVIOUS_CONTRACT_SCHEMA;
    if (!isCurrent && !(options.allowPrevious && isPrevious)) {
        throw new Error(`Product Runtime Contract schema 不受支持：${String(schema)}`);
    }
    exactKeys(
        root,
        isCurrent
            ? ["schema", "commands", "internal", "checks", "shutdown", "startup"]
            : ["schema", "commands", "internal", "checks", "shutdown"],
        "Product Runtime Contract",
    );
    const commands = invocationMap(root.commands, PRODUCT_RUNTIME_COMMAND_IDS, "commands");
    const internal = invocationMap(root.internal, PRODUCT_RUNTIME_INTERNAL_IDS, "internal");
    const checks = invocationMap(root.checks, PRODUCT_RUNTIME_CHECK_IDS, "checks");
    const shutdown = object(root.shutdown, "shutdown");
    exactKeys(shutdown, ["protocol", "path", "timeoutMs", "tokenEnvironment"], "shutdown");
    if (shutdown.protocol !== PRODUCT_SHUTDOWN_PROTOCOL
        || shutdown.path !== PRODUCT_SHUTDOWN_PATH
        || shutdown.timeoutMs !== PRODUCT_SHUTDOWN_TIMEOUT_MS
        || shutdown.tokenEnvironment !== PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT) {
        throw new Error("Product Runtime Contract shutdown 合同不受支持。");
    }
    const startup = isCurrent ? parseStartup(root.startup) : undefined;
    const parsed = {
        schema,
        commands: commands as Record<ProductRuntimeCommandId, ProductRuntimeInvocation>,
        internal: internal as Record<ProductRuntimeInternalId, ProductRuntimeInvocation>,
        checks,
        shutdown: {
            protocol: PRODUCT_SHUTDOWN_PROTOCOL,
            path: PRODUCT_SHUTDOWN_PATH,
            timeoutMs: PRODUCT_SHUTDOWN_TIMEOUT_MS,
            tokenEnvironment: PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT,
        },
        ...(startup ? {startup} : {}),
    } as ParsedProductRuntimeContract;
    return parsed;
}

/** 严格解析 Manager 与 Product 的启动关联及验证回执协议。 */
function parseStartup(value: unknown): ProductRuntimeContract["startup"] {
    const startup = object(value, "startup");
    exactKeys(startup, ["nonceEnvironment", "readyPath", "managerVerification"], "startup");
    if (startup.nonceEnvironment !== PRODUCT_STARTUP_NONCE_ENVIRONMENT
        || startup.readyPath !== PRODUCT_STARTUP_READY_PATH
        || startup.managerVerification !== PRODUCT_MANAGER_VERIFICATION_PROTOCOL) {
        throw new Error("Product Runtime Contract startup 合同不受支持。");
    }
    return {
        nonceEnvironment: PRODUCT_STARTUP_NONCE_ENVIRONMENT,
        readyPath: PRODUCT_STARTUP_READY_PATH,
        managerVerification: PRODUCT_MANAGER_VERIFICATION_PROTOCOL,
    };
}

/** 读取并严格解析一个 Runtime Image 的运行合同。 */
export async function readProductRuntimeContract(imageRoot: string): Promise<ProductRuntimeContract>;
export async function readProductRuntimeContract(imageRoot: string, options: {allowPrevious: true}): Promise<ParsedProductRuntimeContract>;
export async function readProductRuntimeContract(
    imageRoot: string,
    options: {allowPrevious?: boolean} = {},
): Promise<ParsedProductRuntimeContract> {
    const text = await readFile(resolve(imageRoot, ...PRODUCT_RUNTIME_CONTRACT_PATH.split("/")), "utf8");
    return parseProductRuntimeContract(JSON.parse(text) as unknown, options as {allowPrevious: true});
}

/** 解析公开逻辑命令，并执行额外参数策略。 */
export function resolveProductRuntimeCommand(
    contract: ProductRuntimeContract,
    id: string,
    additionalArgs: readonly string[] = [],
): ProductRuntimeInvocation {
    if (!isMember(PRODUCT_RUNTIME_COMMAND_IDS, id)) {
        throw new Error(`未知 Product Runtime command：${id}`);
    }
    return invocation(contract.commands[id], additionalArgs, `command ${id}`);
}

/** 解析 release smoke 逻辑检查，并执行额外参数策略。 */
export function resolveProductRuntimeCheck(
    contract: ProductRuntimeContract,
    id: string,
    additionalArgs: readonly string[] = [],
): ProductRuntimeInvocation {
    if (!isMember(PRODUCT_RUNTIME_CHECK_IDS, id)) {
        throw new Error(`未知 Product Runtime check：${id}`);
    }
    return invocation(contract.checks[id], additionalArgs, `check ${id}`);
}

/** 按当前合同声明顺序解析 `check all` 的完整检查队列。 */
export function resolveProductRuntimeChecks(contract: ProductRuntimeContract): ProductRuntimeInvocation[] {
    return PRODUCT_RUNTIME_CHECK_IDS.map((id) => resolveProductRuntimeCheck(contract, id));
}

/**
 * 解析 bundle 子进程 cwd。交互式 CLI 按调用目录解析相对 Project Workspace 路径；
 * 服务、迁移和 release checks 固定在 Application Root。
 */
export function productRuntimeCwd(
    mode: ProductRuntimeLaunchMode,
    id: string,
    applicationRoot: string,
    invocationCwd: string,
): string {
    return mode === "command" && isMember(PRODUCT_RUNTIME_INVOCATION_CWD_COMMAND_IDS, id)
        ? invocationCwd
        : applicationRoot;
}

/** 解析 Product start 内部步骤；外部调用方不应依赖这些 ID。 */
export function resolveProductRuntimeInternal(
    contract: ProductRuntimeContract,
    id: string,
): ProductRuntimeInvocation {
    if (!isMember(PRODUCT_RUNTIME_INTERNAL_IDS, id)) {
        throw new Error(`未知 Product Runtime internal command：${id}`);
    }
    return invocation(contract.internal[id], [], `internal ${id}`);
}

/** 验证合同中每个入口都存在于 Runtime Image 且是普通文件。 */
export async function assertProductRuntimeContractFiles(
    contract: ParsedProductRuntimeContract,
    imageRoot: string,
): Promise<void> {
    const entries = new Set([
        PRODUCT_RUNTIME_COMMAND_BOOTSTRAP,
        ...Object.values(contract.commands).map((item) => item.entry),
        ...Object.values(contract.internal).map((item) => item.entry),
        ...Object.values(contract.checks).map((item) => item.entry),
    ]);
    for (const entry of entries) {
        const info = await stat(resolve(imageRoot, ...entry.split("/"))).catch(() => null);
        if (!info?.isFile()) {
            throw new Error(`Product Runtime Contract 入口不存在：${entry}`);
        }
    }
}

/** 生成 Runtime Image manifest 使用的稳定合同摘要。 */
export function productRuntimeContractSha256(text: string): string {
    return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function invocation(
    definition: ProductRuntimeInvocation,
    additionalArgs: readonly string[],
    label: string,
): ProductRuntimeInvocation {
    if (additionalArgs.length > 0 && !definition.allowAdditionalArgs) {
        throw new Error(`Product Runtime ${label} 不接受额外参数。`);
    }
    if (additionalArgs.some((argument) => argument.includes("\0"))) {
        throw new Error(`Product Runtime ${label} 参数包含 NUL。`);
    }
    return {...definition, fixedArgs: [...definition.fixedArgs, ...additionalArgs]};
}

function invocationMap(
    value: unknown,
    ids: readonly string[],
    label: string,
): Record<string, ProductRuntimeInvocation> {
    const record = object(value, label);
    exactKeys(record, ids, label);
    return Object.fromEntries(ids.map((id) => [id, parseInvocation(record[id], `${label}.${id}`)]));
}

function parseInvocation(value: unknown, label: string): ProductRuntimeInvocation {
    const record = object(value, label);
    exactKeys(record, ["entry", "fixedArgs", "allowAdditionalArgs"], label);
    if (typeof record.entry !== "string") throw new Error(`${label}.entry 必须是字符串。`);
    const entry = normalizeEntry(record.entry, label);
    if (!Array.isArray(record.fixedArgs) || !record.fixedArgs.every((item) => typeof item === "string" && !item.includes("\0"))) {
        throw new Error(`${label}.fixedArgs 必须是不含 NUL 的字符串数组。`);
    }
    if (typeof record.allowAdditionalArgs !== "boolean") {
        throw new Error(`${label}.allowAdditionalArgs 必须是 boolean。`);
    }
    return {entry, fixedArgs: [...record.fixedArgs], allowAdditionalArgs: record.allowAdditionalArgs};
}

function normalizeEntry(value: string, label: string): string {
    const portable = value.replaceAll("\\", "/");
    if (portable !== value || isAbsolute(value) || win32.isAbsolute(value) || posix.isAbsolute(value)
        || portable.split("/").includes("..") || !portable.startsWith("server/commands/") || !portable.endsWith(".mjs")) {
        throw new Error(`${label}.entry 必须是 server/commands 下的可迁移 .mjs 路径。`);
    }
    return portable;
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} 必须是对象。`);
    }
    return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
    const actual = Object.keys(record).sort();
    const wanted = [...expected].sort();
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
        throw new Error(`${label} 字段不匹配：expected=${wanted.join(",")} actual=${actual.join(",")}`);
    }
}

/** 将不可信字符串收窄到合同登记的逻辑 ID。 */
function isMember<const T extends readonly string[]>(values: T, value: string): value is T[number] {
    return values.includes(value);
}
