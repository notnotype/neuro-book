/**
 * 比较用的三个模型（t02 决定 2）与它们的上游。luna 经 `.env` 的中转直连；两个 Gemini 经 extremelycat，
 * 本机直连它时握手被重置，要经代理（`--model-proxy`）。密钥只交给网关。
 */

import {EvalEnvError, requireEnv} from "../env";
import type {GatewayRoute} from "./gateway";

export interface ModelChoice {
    /** 评测里的短名，也是运行目录的一段。 */
    readonly id: string;
    /** 执行者请求里写的模型名（网关按它找路由）。 */
    readonly model: string;
    /** 推理档：两边相同。两个 Gemini 用最小请求试过 medium 与 high 都回 200。 */
    readonly reasoning: string;
    readonly provider: "luna-relay" | "extremelycat";
}

export const MODELS: readonly ModelChoice[] = [
    {id: "luna", model: "gpt-6-luna", reasoning: "medium", provider: "luna-relay"},
    {id: "hydrogen", model: "gemini-4-hydrogen", reasoning: "medium", provider: "extremelycat"},
    {id: "neon", model: "gemini-4-neon", reasoning: "medium", provider: "extremelycat"},
];

const PROXY_VARS = ["http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"];

/** 调度器进程的环境里有代理变量时报错：Bun 的 `fetch` 缺省会读它们，luna 就会悄悄经代理走。 */
export function assertNoProxyEnv(env: NodeJS.ProcessEnv = process.env): void {
    const present = PROXY_VARS.filter((name) => (env[name] ?? "") !== "");
    if (present.length > 0) throw new EvalEnvError("proxy-env-present", `run the evaluation without proxy variables (found ${present.join(", ")}); pass the model proxy with --model-proxy instead`);
}

/** 按选中的模型从 `.env` 的取值拼出网关的路由；用到 extremelycat 而没给代理时报错。 */
export function routesFor(models: readonly ModelChoice[], env: ReadonlyMap<string, string>, envSource: string, modelProxy: string | null): GatewayRoute[] {
    return models.map((choice) => {
        if (choice.provider === "luna-relay") {
            const keys = requireEnv(env, ["JIJI_LUNA_BASE_URL", "JIJI_LUNA_API_KEY"], envSource);
            return {model: choice.model, baseUrl: keys.JIJI_LUNA_BASE_URL.replace(/\/$/u, ""), apiKey: keys.JIJI_LUNA_API_KEY, proxy: null};
        }
        const keys = requireEnv(env, ["EXTREMELYCAT_BASE_URL", "EXTREMELYCAT_API_KEY"], envSource);
        if (modelProxy === null) throw new EvalEnvError("model-proxy-missing", `${choice.id} goes through extremelycat, which needs --model-proxy`);
        return {model: choice.model, baseUrl: keys.EXTREMELYCAT_BASE_URL.replace(/\/$/u, ""), apiKey: keys.EXTREMELYCAT_API_KEY, proxy: modelProxy};
    });
}
