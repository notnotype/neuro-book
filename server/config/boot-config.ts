import fs from "node:fs";
import * as yaml from "yaml";
import {expandEnvTemplate} from "nbook/server/utils/env-template";
import {resolveBootConfigPath} from "nbook/server/runtime/installation-paths";

export type BootConfig = {
    auth?: {
        enabled?: boolean;
    };
    server?: {
        host?: string;
        port?: number;
    };
    database?: {
        kind?: string;
        url?: string;
    };
};

let cachedAuthEnabled: boolean | null = null;

/**
 * 同步读取启动配置。文件缺失等同于空配置；语法或字段类型错误必须显式失败。
 */
export function loadBootConfigSync(): BootConfig {
    let text: string;
    try {
        text = fs.readFileSync(resolveBootConfigPath(), "utf-8");
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return {};
        }
        throw error;
    }

    return parseBootConfigText(text, process.env);
}

/**
 * 解析指定文本形式的 Boot Config。
 *
 * Manager 在接管保留的 State Root 前复用该合同，避免仅凭同名文件存在
 * 就把任意非空目录认作 NeuroBook 用户数据。
 */
export function parseBootConfigText(text: string, environment: NodeJS.ProcessEnv = process.env): BootConfig {
    const parsed = yaml.parse(expandEnvTemplate(text, environment)) as unknown;
    if (parsed === null || parsed === undefined) {
        return {};
    }
    if (!isRecord(parsed)) {
        throw new Error("config.yaml 顶层必须是对象。");
    }

    validateAuthConfig(parsed.auth);
    return parsed as BootConfig;
}

/**
 * 解析全站鉴权开关。显式配置优先；缺省时开发环境关闭、其他环境开启。
 */
export function resolveBootAuthEnabled(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
    const configured = loadBootConfigSync().auth?.enabled;
    return configured ?? nodeEnv !== "development";
}

/**
 * 读取本进程固定的鉴权开关。首次读取后缓存，确保修改 Boot Config 必须重启才生效。
 */
export function loadBootAuthEnabledSync(): boolean {
    if (cachedAuthEnabled === null) {
        cachedAuthEnabled = resolveBootAuthEnabled();
    }
    return cachedAuthEnabled;
}

function validateAuthConfig(input: unknown): void {
    if (input === undefined) {
        return;
    }
    if (!isRecord(input)) {
        throw new Error("config.yaml auth 必须是对象。");
    }
    if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
        throw new Error("config.yaml auth.enabled 必须是 boolean。");
    }
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === "object" && input !== null && !Array.isArray(input);
}
