import fs from "node:fs/promises";
import path from "node:path";
import * as yaml from "yaml";
import {parseAppConfigText} from "nbook/server/utils/app-config";
import {normalizeGlobalConfig} from "nbook/server/config/normalizer";
import type {StoredGlobalConfig, StoredProviderConfig} from "nbook/server/config/types";
import {resolveBootConfigPath, resolveStateWorkspaceRoot} from "nbook/server/runtime/installation-paths";

const BOOT_CONFIG_PATH = resolveBootConfigPath();
const GLOBAL_CONFIG_PATH = path.join(resolveStateWorkspaceRoot(), ".nbook", "config.json");

/**
 * 迁移旧 config.yaml 中的业务配置到 Workspace Root `.nbook/config.json`。
 *
 * 脚本不会在终端输出 secret；若 Global Config 已存在，会保留其中已配置的 Provider key。
 */
async function main(): Promise<void> {
    await fs.mkdir(path.dirname(GLOBAL_CONFIG_PATH), {recursive: true});

    const oldBootText = await readTextFile(BOOT_CONFIG_PATH);
    assertNoPostgresDatabaseConfig(oldBootText);
    const existingGlobal = await readJsonFile<StoredGlobalConfig>(GLOBAL_CONFIG_PATH);
    const migratedGlobal = buildGlobalConfig(oldBootText, existingGlobal);

    if (!existingGlobal) {
        await writeJsonFile(GLOBAL_CONFIG_PATH, migratedGlobal);
        console.log(`created ${displayPath(GLOBAL_CONFIG_PATH)}`);
    } else {
        await writeJsonFile(GLOBAL_CONFIG_PATH, migratedGlobal);
        console.log(`updated ${displayPath(GLOBAL_CONFIG_PATH)}`);
    }

    const bootConfig = buildBootConfig(oldBootText);
    await fs.writeFile(BOOT_CONFIG_PATH, yaml.stringify(bootConfig), "utf-8");
    console.log(`updated ${displayPath(BOOT_CONFIG_PATH)}`);
    console.log("migration done: Provider/API key 已迁入 workspace/.nbook/config.json，config.yaml 已收窄为 Boot Config。");
}

function buildGlobalConfig(oldBootText: string | null, existingGlobal: StoredGlobalConfig | null): StoredGlobalConfig {
    const legacy = oldBootText ? parseAppConfigText(oldBootText) : parseAppConfigText("");
    const existing = normalizeGlobalConfig(existingGlobal);
    const fromLegacy = normalizeGlobalConfig({
        models: {
            default: legacy.models.defaultModelKey,
            providers: Object.entries(legacy.models.providers).map(([providerId, provider]) => ({
                id: providerId,
                name: provider.name,
                enabled: provider.enabled,
                modelApi: provider.modelApi,
                options: provider.options,
                models: Object.values(provider.models),
            })),
        },
        agent: {
            defaultProfileKey: legacy.agent.defaultProfileKey,
            profiles: legacy.agent.profiles,
        },
        ui: legacy.ui,
        editor: legacy.editor,
    });

    return normalizeGlobalConfig({
        ...fromLegacy,
        ...existingGlobal,
        models: {
            default: existingGlobal?.models?.default ?? fromLegacy.models?.default ?? null,
            providers: mergeProviders(fromLegacy.models?.providers ?? [], existing.models?.providers ?? []),
        },
        agent: {
            defaultProfileKey: {
                novel: existingGlobal?.agent?.defaultProfileKey?.novel ?? fromLegacy.agent?.defaultProfileKey?.novel ?? null,
                userAssets: existingGlobal?.agent?.defaultProfileKey?.userAssets ?? fromLegacy.agent?.defaultProfileKey?.userAssets ?? null,
            },
            profiles: {
                ...(fromLegacy.agent?.profiles ?? {}),
                ...(existingGlobal?.agent?.profiles ?? {}),
            },
        },
        ui: existingGlobal?.ui ?? fromLegacy.ui,
        editor: {
            markdown: existingGlobal?.editor?.markdown ?? fromLegacy.editor?.markdown,
            monaco: existingGlobal?.editor?.monaco ?? fromLegacy.editor?.monaco,
        },
    });
}

function mergeProviders(legacyProviders: StoredProviderConfig[], existingProviders: StoredProviderConfig[]): StoredProviderConfig[] {
    const existingById = new Map(existingProviders.map((provider) => [provider.id, provider]));
    const merged = legacyProviders.map((provider) => {
        const existing = existingById.get(provider.id);
        if (!existing) {
            return provider;
        }
        return {
            ...provider,
            ...existing,
            options: {
                ...provider.options,
                ...existing.options,
                apiKey: existing.options.apiKey || provider.options.apiKey,
            },
            models: existing.models.length > 0 ? existing.models : provider.models,
        };
    });

    for (const provider of existingProviders) {
        if (!legacyProviders.some((legacyProvider) => legacyProvider.id === provider.id)) {
            merged.push(provider);
        }
    }
    return merged.sort((left, right) => left.id.localeCompare(right.id));
}

function buildBootConfig(oldBootText: string | null): Record<string, unknown> {
    const oldConfig = oldBootText ? yaml.parse(oldBootText) as Record<string, unknown> : {};
    const authEnabled = normalizeRecord(oldConfig.auth).enabled;
    return {
        ...(typeof authEnabled === "boolean" ? {
            auth: {enabled: authEnabled},
        } : {}),
        server: normalizeRecord(oldConfig.server),
        database: {
            kind: "${DATABASE_KIND:-sqlite}",
            url: "${DATABASE_URL:-file:./workspace/.nbook/neuro-book.sqlite}",
        },
    };
}

function assertNoPostgresDatabaseConfig(oldBootText: string | null): void {
    if (!oldBootText) {
        return;
    }
    const oldConfig = yaml.parse(oldBootText) as {database?: {kind?: unknown; url?: unknown}} | null;
    const database = oldConfig?.database;
    if (!database || typeof database !== "object") {
        return;
    }
    const kind = typeof database.kind === "string" ? database.kind.toLowerCase() : "";
    const url = typeof database.url === "string" ? database.url.toLowerCase() : "";
    if (kind.includes("postgres") || url.includes("postgres://") || url.includes("postgresql://")) {
        throw new Error("当前版本已移除 PostgreSQL 支持。请先将 App 数据库切换为 SQLite file: URL；本脚本不迁移旧 PostgreSQL 数据。");
    }
}

function normalizeRecord(input: unknown): Record<string, unknown> {
    return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

async function readTextFile(filePath: string): Promise<string | null> {
    try {
        return await fs.readFile(filePath, "utf-8");
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
    const text = await readTextFile(filePath);
    return text ? JSON.parse(text) as T : null;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 4)}\n`, "utf-8");
}

function displayPath(filePath: string): string {
    return path.relative(process.cwd(), filePath).replaceAll("\\", "/");
}

await main();
