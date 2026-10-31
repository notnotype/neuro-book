/**
 * 工具 id 与交给服务商的名字（t04 决定 1）：`.` 换成 `__`，所以 id 里不许有 `__`；名字最长 64 个字符，
 * 只用服务商都接受的 `[A-Za-z0-9_-]`。请求校验与模型适配器共用这一份。
 */

const TOOL_ID = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/u;
const PROVIDER_NAME = /^[A-Za-z0-9_-]{1,64}$/u;
export const TOOL_NAME_LIMIT = 64;

/** id 不合规则时返回问题（英文，给开发者看），否则 null。 */
export function toolIdProblem(id: string): string | null {
    if (!TOOL_ID.test(id)) return `tool id ${id} must be dot-separated segments of [A-Za-z0-9_-]`;
    if (id.includes("__")) return `tool id ${id} must not contain "__" (it is how "." is spelled for providers)`;
    return null;
}

/** 交给服务商的名字：显式的 `providerName`，否则由 id 换算。 */
export function providerToolName(declaration: {readonly id: string; readonly providerName?: string}): string {
    return declaration.providerName ?? declaration.id.replaceAll(".", "__");
}

export function providerNameProblem(name: string): string | null {
    return PROVIDER_NAME.test(name) ? null : `tool name ${name} must be 1-${TOOL_NAME_LIMIT} characters of [A-Za-z0-9_-]`;
}
