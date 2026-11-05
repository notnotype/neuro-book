/**
 * 插件声明的登记共用的两步判定（docs/specs/canon/components.md 输出 17 的标注种类、model.md “诊断的登记”）：
 *
 * 1. 前缀：`id` 必须是 `<声明它的插件 id>.<名>`。不是的那条不登记、写诊断，也不参与下一步，所以别的插件冒用
 *    同一个 id 不能让本来的那条一起失效。
 * 2. 重复：剩下的里同一个 `id` 出现不止一次的，全部不登记，不按登记先后决定谁赢。
 *
 * 过了这两步的声明再由各自的登记做形状与内容的校验。
 */

export interface PluginContribution<D> {
    /** 声明它的插件 id。 */
    readonly plugin: string;
    readonly declaration: D;
}

export interface Admitted<D> {
    readonly id: string;
    readonly plugin: string;
    readonly declaration: D;
}

export interface Rejected {
    readonly id: string;
    readonly plugin: string;
    readonly message: string;
}

export function admitDeclarations<D>(contributions: readonly PluginContribution<D>[]): {readonly admitted: readonly Admitted<D>[]; readonly rejected: readonly Rejected[]} {
    const rejected: Rejected[] = [];
    const byId = new Map<string, Admitted<D>[]>();
    for (const {plugin, declaration} of contributions) {
        const raw = (declaration as {id?: unknown} | null)?.id;
        const id = typeof raw === "string" ? raw : "";
        if (!id.startsWith(`${plugin}.`) || id.length === plugin.length + 1) {
            rejected.push({id, plugin, message: `id "${id}" must be "${plugin}.<name>"`});
            continue;
        }
        const list = byId.get(id) ?? [];
        list.push({id, plugin, declaration});
        byId.set(id, list);
    }
    const admitted: Admitted<D>[] = [];
    for (const [id, list] of byId) {
        if (list.length === 1) admitted.push(list[0]!);
        else for (const item of list) rejected.push({id, plugin: item.plugin, message: `id "${id}" is declared ${String(list.length)} times`});
    }
    return {admitted, rejected};
}

/** `[id, 版本]` 按 id 排（UTF-16 码元），读取输入的摘要用（model.md 输出 36）。 */
export function sortedVersions(items: Iterable<{readonly id: string; readonly version: number}>): readonly (readonly [string, number])[] {
    return [...items].map((item) => [item.id, item.version] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
