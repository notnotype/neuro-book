import type {WorldWorkbenchPreviewSlice} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

const subjectSystemMaintenanceTitleHints = [
    "旧主体链接",
    "主体系统",
    "主体经历记忆",
];

/** 判断一个 slice 是否属于项目级主体系统维护切片，而不是用户要优先浏览的世界事件。 */
export function isWorldWorkbenchSubjectSystemMaintenanceSlice(slice: Pick<WorldWorkbenchPreviewSlice, "kind" | "title" | "summary">): boolean {
    if (slice.kind !== "init") {
        return false;
    }
    const text = `${slice.title} ${slice.summary}`;
    return subjectSystemMaintenanceTitleHints.some((hint) => text.includes(hint));
}
