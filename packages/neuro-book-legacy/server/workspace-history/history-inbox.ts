import type {InboxGroup} from "@notnotype/nb-history";

export type WorkspaceHistoryInboxGroupMatch =
    | {kind: "matched"; group: InboxGroup}
    | {kind: "missing"}
    | {kind: "stale"; currentRevision: number};

/**
 * 计算单个收件箱分组的稳定版本号。
 *
 * Inbox group 内 entry id 单调递增；最大 id 代表用户当前看到的该文件审查版本。
 */
export function workspaceHistoryGroupRevision(group: Pick<InboxGroup, "entries">): number {
    return group.entries.reduce((revision, entry) => Math.max(revision, entry.id), 0);
}

/** 计算整个收件箱的版本号；空收件箱固定为 0。 */
export function workspaceHistoryInboxRevision(groups: Array<Pick<InboxGroup, "entries">>): number {
    return groups.reduce((revision, group) => Math.max(revision, workspaceHistoryGroupRevision(group)), 0);
}

/**
 * 按 Project Workspace 相对路径与版本号匹配当前收件箱分组。
 * 路径存在但版本不同必须区分为 stale，禁止调用方误操作更新后的分组。
 */
export function matchWorkspaceHistoryInboxGroup(
    groups: InboxGroup[],
    path: string,
    revision: number,
): WorkspaceHistoryInboxGroupMatch {
    const group = groups.find((item) => item.path === path);
    if (!group) {
        return {kind: "missing"};
    }
    const currentRevision = workspaceHistoryGroupRevision(group);
    if (currentRevision !== revision) {
        return {kind: "stale", currentRevision};
    }
    return {kind: "matched", group};
}
