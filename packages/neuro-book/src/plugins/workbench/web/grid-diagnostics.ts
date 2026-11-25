/**
 * 网格的诊断进窗口的诊断（docs/specs/ui/workbench-layout.md 的“失败与恢复”）：`WorkbenchSurface` 交出的布局重算与手势的诊断、
 * 被拒的提交，逐条记成事件 `workbench.grid`。
 *
 * - 级别按码分：窗口尺寸与用户操作的结果（放不下、空间没人吸收、收起或恢复没有空间、交换不成立）是设计好的降级，记 debug：
 *   半屏宽的窗口就有一条持续的 `over-constrained`，记成 warn 会让开发者工具常驻一条警告，也会让收集控制台警告的 e2e 失败。
 *   落账之后通知抛出记 error：文档可能没写上。被拒的提交（已经回滚）与别的码（接线或时序的 bug，含以后新增的码）记 warn。
 * - 码写进消息文字的开头：浏览器出口把 `data` 作为第二个参数，只读控制台文字的人与 e2e 看不到它。
 * - 不另做去重：`useGridHost` 只发新出现的诊断（docs/specs/ui/nested-grid.md 输出 140），同一个问题持续时不再发。
 * - 类型只从 nb-layout 的根入口取：本文件随插件入口在后端的类型检查范围里，`./vue` 会把 DOM 类型带进来。
 */

import type {GridFailure, GridHostIssueCode, GridIssue, GridIssueCode} from "@notnotype/nb-layout";
import type {DiagnosticsService} from "@notnotype/nb-runtime/diagnostics";

/** 与 nb-layout `./vue` 的 `GridHostIssue` 同形：布局重算与手势的诊断，或被拒的提交（带 `ok`）。 */
export type WorkbenchGridIssue = GridIssue<GridIssueCode | GridHostIssueCode> | GridFailure;

/** 可以预期的降级：窗口尺寸或用户操作的结果。 */
const EXPECTED: ReadonlySet<string> = new Set<GridIssueCode>(["over-constrained", "unabsorbed-space", "no-room-to-collapse", "no-room-to-restore", "swap-skipped"]);

/** 这条诊断记成什么级别。 */
export function gridIssueLevel(issue: WorkbenchGridIssue): "debug" | "warn" | "error" {
    if ("ok" in issue) return "warn";
    if (EXPECTED.has(issue.code)) return "debug";
    if (issue.code === "notify-failed") return "error";
    return "warn";
}

/** 逐条记进诊断：事件 `workbench.grid`，`data` 带码、是不是被拒的提交与参数。 */
export function recordGridIssues(diagnostics: Pick<DiagnosticsService, "record">, issues: readonly WorkbenchGridIssue[], plugin: string): void {
    for (const issue of issues) {
        const rejected = "ok" in issue;
        diagnostics.record({
            level: gridIssueLevel(issue),
            event: "workbench.grid",
            message: `${rejected ? "rejected " : ""}${issue.code}: ${issue.message}`,
            data: {code: issue.code, rejected, ...(issue.params === undefined ? {} : {params: issue.params})},
            source: {plugin},
        });
    }
}
