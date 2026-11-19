/**
 * 诊断的“只发新增”（Spec `ui/nested-grid` 输出 140，库内用，不从入口导出）。
 *
 * 键是码、`cause`、`axis`、`id`：同一个节点同一个原因在同一根轴上算同一条，度量（数）不进键，窗口拖窄时数每个像素都变也不算新的。
 * 同一次求解里同一个键最多一条（每个节点只量一次），所以不用合成，参数天然对得上。`useGridLayout` 按重算、`useSashGesture` 按手势各用一个闸门。
 */
import type {GridIssue} from "./grid-types";

export function issueKey(issue: GridIssue): string {
    const params = issue.params ?? {};
    return [issue.code, params.cause ?? "", params.axis ?? "", params.id ?? ""].map(String).join("\u0000");
}

export type IssueGate = {
    /** 手势用：交回这批里键没见过的（同一批里同键的只交第一条），并把它们记下。 */
    take<I extends GridIssue>(batch: readonly I[]): I[];
    /** 布局重算用：交回这批里不在上一批的，再用这批的键换掉键集；`replace([])` 就是清空。消失再出现会再交。 */
    replace<I extends GridIssue>(batch: readonly I[]): I[];
};

export function createIssueGate(): IssueGate {
    let seen = new Set<string>();
    return {
        take<I extends GridIssue>(batch: readonly I[]): I[] {
            const fresh: I[] = [];
            for (const issue of batch) {
                const key = issueKey(issue);
                if (!seen.has(key)) {
                    seen.add(key);
                    fresh.push(issue);
                }
            }
            return fresh;
        },
        replace<I extends GridIssue>(batch: readonly I[]): I[] {
            const previous = seen;
            seen = new Set();
            const fresh: I[] = [];
            for (const issue of batch) {
                const key = issueKey(issue);
                if (!seen.has(key)) {
                    seen.add(key);
                    if (!previous.has(key)) {
                        fresh.push(issue);
                    }
                }
            }
            return fresh;
        },
    };
}
