/**
 * 一个 Profile 的工具集怎样算、绑定怎样改（docs/specs/agent/contributions.md 输出 4，profile-settings.md 输出 11–16）。服务端算
 * 工具集与设置页显示、改绑定用同一份，页面显示的才是请求里的。
 */

/** 新建用户级 Profile 时的名字（contributions.md 输出 18）；手写的文件名不受它限制。 */
export const USER_PROFILE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const USER_PROFILE_PREFIX = "user.";

/** 用户级 Profile 入口文件的资源地址：文件名就是 key 去掉前缀。 */
export const userProfileAddress = (key: string): string => `user://profiles/${key.slice(USER_PROFILE_PREFIX.length)}.profile.tsx`;

export interface ToolRequirements {
    readonly required: readonly string[];
    readonly optional: readonly string[];
    /** `false`：不加 `defaultForAll` 的工具。 */
    readonly defaultTools?: false;
}

export interface ToolBinding {
    readonly added: readonly string[];
    readonly removed: readonly string[];
}

/** 写进设置项的形状（`shared/settings.ts` 的 `ToolBinding`）。 */
type WritableBinding = {added: string[]; removed: string[]};

/** 工具集的 id，顺序有意义：同名的先出现者胜出。 */
export function profileToolIds(requirements: ToolRequirements, defaultForAll: readonly string[], binding: ToolBinding | undefined): string[] {
    const wanted = new Set([...requirements.required, ...requirements.optional]);
    if (requirements.defaultTools !== false) for (const id of defaultForAll) wanted.add(id);
    for (const id of binding?.added ?? []) wanted.add(id);
    const required = new Set(requirements.required);
    for (const id of binding?.removed ?? []) if (!required.has(id)) wanted.delete(id);
    return [...wanted];
}

/**
 * 模型实际看到的：内核按交给模型的名字去重，先出现的胜出（harness/runtime.md 输出 15）。`nameOf` 交回 undefined 的工具已经不存在，
 * 不算进来（`forProfile` 同样忽略）。
 */
export function visibleToolIds(ids: readonly string[], nameOf: (id: string) => string | undefined): string[] {
    const names = new Set<string>();
    return ids.filter((id) => {
        const name = nameOf(id);
        if (name === undefined || names.has(name)) return false;
        names.add(name);
        return true;
    });
}

export interface ToolChange {
    readonly add?: readonly string[];
    readonly remove?: readonly string[];
}

/**
 * 按“本来就有的”（Profile 要的加 `defaultForAll`）换算成绑定：开回本来就有的从 `removed` 删掉，不写进 `added`；关掉绑定加的从
 * `added` 删掉，不写进 `removed`。必需的不进 `removed`。
 */
export function changeToolBinding(binding: ToolBinding | undefined, requirements: ToolRequirements, defaultForAll: readonly string[], change: ToolChange): WritableBinding {
    const base = new Set(profileToolIds(requirements, defaultForAll, undefined));
    const required = new Set(requirements.required);
    const added = new Set(binding?.added ?? []);
    const removed = new Set(binding?.removed ?? []);
    for (const id of change.remove ?? []) {
        added.delete(id);
        if (base.has(id) && !required.has(id)) removed.add(id);
    }
    for (const id of change.add ?? []) {
        removed.delete(id);
        if (!base.has(id)) added.add(id);
    }
    return {added: [...added], removed: [...removed]};
}

/** 整份绑定里换掉这个 Profile 的：`added`、`removed` 都空时不留这个 key。别的 Profile 原样留着。 */
export function withToolBinding(bindings: Readonly<Record<string, WritableBinding>>, profile: string, binding: WritableBinding | undefined): Record<string, WritableBinding> {
    const next: Record<string, WritableBinding> = {...bindings};
    if (binding === undefined || (binding.added.length === 0 && binding.removed.length === 0)) delete next[profile];
    else next[profile] = binding;
    return next;
}

/** 加这个工具会碰上的同名工具（profile-settings.md 输出 15）：`replaces` 能换掉，`blockedBy` 是必需的、换不掉。 */
export function sameNameTool(
    id: string,
    visible: readonly string[],
    nameOf: (id: string) => string | undefined,
    required: readonly string[],
): {readonly replaces?: string; readonly blockedBy?: string} {
    const name = nameOf(id);
    const other = name === undefined ? undefined : visible.find((tool) => tool !== id && nameOf(tool) === name);
    if (other === undefined) return {};
    return required.includes(other) ? {blockedBy: other} : {replaces: other};
}
