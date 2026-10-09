/**
 * 粘贴与拖动移入的计划（docs/specs/workbench/files-explorer.md 的“基础文件操作”与验收 6、7）：把冻结的源与目标目录排成
 * 一项项“源 → 目标地址”，找出与目标目录已有名字（以及本批里已经排好的名字）相撞的项，并给出不相撞的候选名。预判只为
 * 问用户；提交仍由服务端排他重验，预判之后被占用照样是该项冲突。
 */

/** 一项冻结的源：地址、身份令牌与名字。 */
export interface PlanSource {
    readonly address: string;
    readonly token: string;
    readonly name: string;
    readonly directory: boolean;
}

/** 已决定的一项：要发给批量的源、令牌与目标名。 */
export interface PlannedItem {
    readonly source: PlanSource;
    readonly name: string;
}

/** 对一项同名的处理。 */
export type CollisionChoice = {readonly kind: "rename"; readonly name: string} | {readonly kind: "skip"} | {readonly kind: "cancel"};

/** 候选名：`名字 (2).扩展名`，数字递增到不与 `taken` 相撞；目录不拆扩展名。 */
export function candidateName(name: string, directory: boolean, taken: ReadonlySet<string>): string {
    const dot = directory ? -1 : name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    for (let index = 2; ; index += 1) {
        const next = `${stem} (${String(index)})${extension}`;
        if (!taken.has(next)) return next;
    }
}

/**
 * 逐项排名字：不相撞的直接用原名；相撞的交给 `decide`（同目录复制的源与自己同名，同样要改名）。`decide` 返回取消时
 * 剩下的项都不做；`existing` 是目标目录此刻的名字。
 */
export async function planNames(sources: ReadonlyArray<PlanSource>, existing: ReadonlySet<string>, decide: (source: PlanSource, taken: ReadonlySet<string>) => Promise<CollisionChoice>): Promise<{readonly items: PlannedItem[]; readonly skipped: PlanSource[]; readonly cancelled: PlanSource[]}> {
    const taken = new Set(existing);
    const items: PlannedItem[] = [];
    const skipped: PlanSource[] = [];
    for (const [index, source] of sources.entries()) {
        if (!taken.has(source.name)) {
            taken.add(source.name);
            items.push({source, name: source.name});
            continue;
        }
        const choice = await decide(source, taken);
        if (choice.kind === "cancel") return {items, skipped, cancelled: sources.slice(index)};
        if (choice.kind === "skip") {
            skipped.push(source);
            continue;
        }
        taken.add(choice.name);
        items.push({source, name: choice.name});
    }
    return {items, skipped, cancelled: []};
}
