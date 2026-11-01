/**
 * 服务端与设置页共用的纯规则（docs/specs/models/service.md 输出 5、8、9）：模型引用的写法、自定义服务商 id 的生成、
 * “这个模型能不能用”与“哪些角色用着它”。两边用同一份，删服务商的确认与解析得到的结论一致。
 */

import type {ModelConfig, ProviderConfig, RoleConfig} from "./settings";

/** `<服务商>/<模型>`：按第一个 `/` 切，模型 id 自己可以带 `/`（OpenRouter）。 */
export function splitReference(reference: string): {readonly provider: string; readonly model: string} | null {
    const slash = reference.indexOf("/");
    if (slash <= 0 || slash === reference.length - 1) return null;
    return {provider: reference.slice(0, slash), model: reference.slice(slash + 1)};
}

export const referenceOf = (provider: string, model: string): string => `${provider}/${model}`;

/**
 * 自定义服务商的 id：由名字转成 `[a-z0-9._-]`，转不出东西（例如全是中文）时用 `custom`；与 `taken`（已添加的与目录里的）
 * 冲突时加 `-2`、`-3`（同旧应用）。
 */
export function providerIdFor(name: string, taken: ReadonlySet<string>): string {
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^[^a-z0-9]+|-+$/gu, "");
    const base = slug === "" ? "custom" : slug;
    if (!taken.has(base)) return base;
    for (let suffix = 2; ; suffix += 1) {
        const candidate = `${base}-${String(suffix)}`;
        if (!taken.has(candidate)) return candidate;
    }
}

/** 自定义模型启用时缺上下文窗口（压缩要用）：不能启用、不能用。 */
export function missingContextWindow(provider: Pick<ProviderConfig, "kind">, model: Pick<ModelConfig, "contextWindow">): boolean {
    return provider.kind === "custom" && model.contextWindow === undefined;
}

/** 绑着这个服务商（给了模型时只看这个模型）的角色。 */
export function rolesUsing<Role extends Pick<RoleConfig, "model">>(roles: readonly Role[], provider: string, model?: string): Role[] {
    return roles.filter((role) => {
        if (role.model === null) return false;
        const target = splitReference(role.model);
        return target !== null && target.provider === provider && (model === undefined || target.model === model);
    });
}

/**
 * 模型的系列（界面按它分组）：没写 `group` 时由 id 推，去掉末尾一到两段版本、尺寸与变体后缀（`claude-sonnet-4-5` →
 * `claude-sonnet`，`qwen3:8b` → `qwen3`）。只用来分组，推错了用户在编辑对话框里改。
 */
export function seriesOf(id: string): string {
    const variant = /[-:](\d[\w.]*|latest|preview|flash|lite|pro|mini|max|turbo|thinking|chat|reasoner|instruct|vision)$/iu;
    let series = id;
    for (let round = 0; round < 2; round += 1) {
        const next = series.replace(variant, "");
        if (next === series || next === "") break;
        series = next;
    }
    return series;
}
