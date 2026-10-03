import fs from "node:fs";
import path from "node:path";
import * as yaml from "yaml";
import {resolveAppSqliteLocation, selectAppSqliteUrl} from "nbook/server/runtime/app-sqlite-location";
import {resolveBootConfigPath, resolveStateRoot} from "nbook/server/runtime/installation-paths";

export type DatabaseKind = "sqlite";

export type DatabaseRuntimeConfig = {
    kind: DatabaseKind;
    /** `.env`/Boot Config中的逻辑值。 */
    configuredUrl: string;
    /** 当前进程可直接连接的绝对file URL。 */
    url: string;
    sqliteFilePath: string;
    sqliteScope: "state-root" | "external";
};

export type ResolveDatabaseConfigOptions = {
    /** false 用于只读迁移门禁，不得因解析配置创建数据库父目录。 */
    ensureDirectory?: boolean;
};

/**
 * 解析当前进程实际使用的数据库配置。
 *
 * `.env` / 进程环境是执行真值源；`config.yaml` 只作为部署镜像和诊断输入，
 * 不覆盖进程环境。缺省时使用 App SQLite 文件库。
 */
export function resolveDatabaseConfig(options: ResolveDatabaseConfigOptions = {}): DatabaseRuntimeConfig {
    const bootDatabase = readBootDatabaseConfig();
    const envKind = normalizeKind(process.env.DATABASE_KIND);
    const envUrl = normalizeText(process.env.DATABASE_URL);
    const bootKind = normalizeKind(bootDatabase.kind);
    const bootUrl = normalizeText(bootDatabase.url);
    const kind = envKind ?? inferKindFromUrl(envUrl) ?? bootKind ?? inferKindFromUrl(bootUrl) ?? "sqlite";
    const url = selectAppSqliteUrl(envUrl, bootUrl);

    assertDatabaseConfig(kind, url);
    const location = resolveAppSqliteLocation(url, resolveStateRoot());
    if (options.ensureDirectory !== false) {
        fs.mkdirSync(path.dirname(location.hostPath), {recursive: true});
    }

    return {
        kind,
        configuredUrl: location.configuredUrl,
        url: location.connectionUrl,
        sqliteFilePath: location.hostPath,
        sqliteScope: location.scope,
    };
}

/**
 * 判断当前 Database Kind。
 */
export function currentDatabaseKind(): DatabaseKind {
    return resolveDatabaseConfig().kind;
}

/**
 * SQLite URL 默认值，供部署脚本和测试复用。
 */
export function defaultSqliteDatabaseUrl(): string {
    return selectAppSqliteUrl(undefined, undefined);
}

/**
 * 将 SQLite file URL 解析成本机绝对路径。
 */
export function resolveSqliteFilePath(url: string): string {
    return resolveAppSqliteLocation(url, resolveStateRoot()).hostPath;
}

function readBootDatabaseConfig(): {kind?: unknown; url?: unknown} {
    try {
        const text = fs.readFileSync(resolveBootConfigPath(), "utf-8");
        const expanded = expandEnvTemplates(text);
        const parsed = yaml.parse(expanded) as {database?: {kind?: unknown; url?: unknown}} | null;
        return parsed?.database && typeof parsed.database === "object" ? parsed.database : {};
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return {};
        }
        throw error;
    }
}

function expandEnvTemplates(input: string): string {
    return input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g, (_match, name: string, fallback: string | undefined) => {
        const value = process.env[name];
        return value !== undefined && value !== "" ? value : fallback ?? "";
    });
}

function normalizeKind(input: unknown): DatabaseKind | null {
    const value = normalizeText(input).toLowerCase();
    if (!value) {
        return null;
    }
    if (value === "sqlite") {
        return "sqlite";
    }
    throw new Error(`DATABASE_KIND 只支持 sqlite，当前为：${String(input)}`);
}

function normalizeText(input: unknown): string {
    return typeof input === "string" ? input.trim() : "";
}

function inferKindFromUrl(url: string): DatabaseKind | null {
    if (!url) {
        return null;
    }
    if (url.startsWith("file:")) {
        return "sqlite";
    }
    throw new Error(`DATABASE_URL 只支持 SQLite file: URL，当前为：${url}`);
}

function assertDatabaseConfig(kind: DatabaseKind, url: string): void {
    if (kind !== "sqlite" || !url.startsWith("file:")) {
        throw new Error(`App SQLite DATABASE_URL 必须以 file: 开头，当前为：${url || "<empty>"}`);
    }
}
