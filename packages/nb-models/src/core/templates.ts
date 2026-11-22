/**
 * 服务商模板表（docs/specs/models/service.md“术语”与输出 19）：OMP 打包目录里的每个服务商加三个空白模板。我方只补分组、地区与
 * “为什么不能添加”的判断；协议、地址、模型数都从打包目录算，不手抄。纯数据与纯函数，进程内算一次。
 */

import {chatModels, listCatalog, templateRoutes} from "@notnotype/nb-harness/models";

import {BLANK_API, BLANK_TEMPLATES, isBlankTemplate} from "../config/shapes";
import type {BlankTemplate} from "../config/shapes";
import type {Template} from "../contract/shapes";

type Group = Template["group"];

/** 分组（添加对话框按它分栏）：没登记的归“其他”。 */
const GROUPS: Readonly<Record<string, Group>> = {
    openai: "international", anthropic: "international", google: "international", xai: "international", mistral: "international", groq: "international",
    cerebras: "international", fireworks: "international", together: "international", deepinfra: "international", meta: "international", sakana: "international",
    inception: "international", "gmi-cloud": "international", baseten: "international", sambanova: "international", venice: "international",
    deepseek: "china", moonshot: "china", minimax: "china", "minimax-cn": "china", "minimax-code": "china", "minimax-code-cn": "china", zai: "china",
    "zhipu-coding-plan": "china", "alibaba-coding-plan": "china", "alibaba-token-plan": "china", qianfan: "china", stepfun: "china", xiaomi: "china",
    "xiaomi-token-plan-ams": "china", "xiaomi-token-plan-cn": "china", "xiaomi-token-plan-sgp": "china", "kimi-code": "china", siliconflow: "china", umans: "china",
    openrouter: "gateway", "vercel-ai-gateway": "gateway", kilo: "gateway", nanogpt: "gateway", zenmux: "gateway", "opencode-zen": "gateway", "opencode-go": "gateway",
    huggingface: "gateway", aimlapi: "gateway", "cloudflare-ai-gateway": "gateway", commandcode: "gateway", synthetic: "gateway", nvidia: "gateway", novita: "gateway",
    "wafer-serverless": "gateway", coreweave: "gateway", "yolo-auto": "gateway", "cline-pass": "gateway",
};

/** 有地区的模板：改地址时按地区选，不必手填。地区地址仍是模板自己定的，所以选了地区仍算“跟随模板”。 */
const REGIONS: Readonly<Record<string, ReadonlyArray<{readonly id: string; readonly baseUrl: string}>>> = {
    moonshot: [{id: "global", baseUrl: "https://api.moonshot.ai/v1"}, {id: "cn", baseUrl: "https://api.moonshot.cn/v1"}],
    minimax: [{id: "global", baseUrl: "https://api.minimax.io/anthropic"}, {id: "cn", baseUrl: "https://api.minimaxi.com/anthropic"}],
};

/** 目录里没有对话模型也要列出来（带原因停用）的服务商：用户找得到它、知道为什么不能加，而不是以为没收录。 */
const ALWAYS_LISTED = new Set(["cursor", "amazon-bedrock", "azure", "google-vertex", "openai-codex", "google-gemini-cli", "google-antigravity"]);

let table: readonly Template[] | undefined;

function reasonOf(id: string, access: string, routes: Template["routes"]): Template["reason"] {
    if (access === "login") return "login";
    if (access === "unsupported") return "unsupported-auth";
    if (routes.length === 0) return chatModels(id).length === 0 ? "transport" : "needs-address";
    return null;
}

export function listTemplates(): readonly Template[] {
    table ??= [
        ...listCatalog()
            .filter((provider) => provider.models.some((model) => model.wire !== null) || ALWAYS_LISTED.has(provider.id))
            .map((provider): Template => {
                const routes = templateRoutes(provider.id).map((route) => ({...route}));
                const reason = reasonOf(provider.id, provider.access, routes);
                return {
                    id: provider.id,
                    name: provider.name,
                    group: GROUPS[provider.id] ?? "other",
                    logo: provider.id,
                    blank: false,
                    addable: reason === null,
                    reason,
                    modelCount: chatModels(provider.id).length,
                    regions: [...(REGIONS[provider.id] ?? [])].map((region) => ({...region})),
                    routes,
                    access: provider.access === "login" ? "login" : provider.access === "keyless" ? "keyless" : "key",
                };
            }),
        ...BLANK_TEMPLATES.map((id): Template => ({id, name: id, group: "custom", logo: null, blank: true, addable: true, reason: null, modelCount: 0, regions: [], routes: [], access: "key"})),
    ];
    return table;
}

export const templateOf = (id: string): Template | undefined => listTemplates().find((template) => template.id === id);

/** 模板的缺省协议：空白模板是它自己的，目录模板取第一条路由（混合协议的每个模型各用各的，这里只给界面显示用）。 */
export function defaultApi(id: string): Template["routes"][number]["api"] | null {
    if (isBlankTemplate(id)) return BLANK_API[id as BlankTemplate];
    return templateOf(id)?.routes[0]?.api ?? null;
}
