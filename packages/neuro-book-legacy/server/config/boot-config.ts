import fs from "node:fs";
import {parseBootConfigText} from "@notnotype/neuro-book-contracts/installation";
import type {BootConfig} from "@notnotype/neuro-book-contracts/installation";
import {resolveBootConfigPath} from "nbook/server/runtime/installation-paths";
export {parseBootConfigText};


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

