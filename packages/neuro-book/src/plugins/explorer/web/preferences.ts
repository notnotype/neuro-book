/**
 * 资源管理器的偏好记录（docs/specs/workbench/files-explorer.md 的“新应用的插件、命令与界面”中“持久化”）：“显示清单
 * 文件”与两棵树的展开集合。记录归 `nbook.explorer`；旧应用的 `workbench.files` 记录不迁移。
 *
 * 展开按根分两份：项目树按项目记忆（project/local），用户资产跨项目（user/local，没打开项目也保存）。保存暂停（确定
 * 失败、结果未知）期间新的展开只改显示并记下最后一份，恢复后再提交，不在队列里堆积一串过时的值。
 */

import {Type} from "typebox";

import {MAX_PATH_BYTES, RESOURCE_PATH_PATTERN} from "nbook/plugins/files/shared/contracts";
import {defineRecord, MAX_RECORD_MAX_BYTES} from "nbook/shared/storage";
import {defineStore} from "nbook/shared/store/store";
import type {PersistedField} from "nbook/shared/store/store";

import {isWithin, parentAddress} from "./tree/address";

/** 每份展开记录最多这么多条；超出时按分支淘汰最早展开的。 */
export const EXPANDED_LIMIT = 2000;

const PreferencesSchema = Type.Object({showManifests: Type.Boolean()}, {additionalProperties: false});
// 路径按资源地址的规则校验：外部改坏的记录（`..`、空段）由 Storage 判为损坏并保护，不让非法地址进到树的地址运算里。
const ExpandedSchema = Type.Object({paths: Type.Array(Type.String({pattern: RESOURCE_PATH_PATTERN, maxLength: MAX_PATH_BYTES}), {maxItems: EXPANDED_LIMIT})}, {additionalProperties: false});

export type ExplorerPreferences = {readonly showManifests: boolean};
export type ExpandedPaths = {readonly paths: ReadonlyArray<string>};

export const EXPLORER_RECORDS = {
    preferences: defineRecord({key: "explorer.preferences", scope: "user", locality: "local", version: 1, schema: PreferencesSchema}),
    expanded: defineRecord({key: "explorer.expanded", scope: "project", locality: "local", version: 1, schema: ExpandedSchema, maxBytes: MAX_RECORD_MAX_BYTES}),
    userExpanded: defineRecord({key: "explorer.user-expanded", scope: "user", locality: "local", version: 1, schema: ExpandedSchema, maxBytes: MAX_RECORD_MAX_BYTES}),
} as const;

/**
 * 按分支淘汰：`addresses` 按展开先后排列，超出 `limit` 时从最早的开始去掉，去掉一个目录时连同记录里它的后代一起
 * 去掉，不留下祖先已不在的后代（它们恢复不出来，还占着名额）。方案根不淘汰：它是全部地址的祖先，淘汰它等于清空。
 */
export function limitBranches(addresses: ReadonlyArray<string>, limit: number): string[] {
    let kept = [...addresses];
    while (kept.length > limit) {
        const evicted = kept.find((address) => parentAddress(address) !== null);
        if (evicted === undefined) break;
        kept = kept.filter((address) => !isWithin(address, evicted));
    }
    return kept;
}

/** 一条记录的问题：读不到（正在用缺省值浏览）、记录损坏或版本不认识（不覆盖），或有修改没保存上。 */
export type PreferenceProblem =
    | {readonly kind: "unread"; readonly code: string}
    | {readonly kind: "protected"; readonly code: string}
    | {readonly kind: "unsaved"; readonly code: string};

export type ExpandedRecord = "expanded" | "userExpanded";

const paused = (field: PersistedField<unknown>): boolean => field.save.state === "failed" || field.save.state === "unknown";

function defineExplorerStore(bound: boolean) {
    return defineStore("explorer", ({persist}) => {
        const preferences = persist(EXPLORER_RECORDS.preferences, {initial: {showManifests: false}});
        const expanded = bound ? persist(EXPLORER_RECORDS.expanded, {initial: {paths: [""]}}) : null;
        const userExpanded = persist(EXPLORER_RECORDS.userExpanded, {initial: {paths: []}});
        const fields: Array<PersistedField<ExplorerPreferences> | PersistedField<ExpandedPaths>> = [preferences, ...(expanded === null ? [] : [expanded]), userExpanded];
        /** 暂停期间每份记录的最后一个值：恢复保存后只提交它。 */
        const latest = new Map<PersistedField<unknown>, () => void>();

        /** 提交一个新值；保存暂停时只改显示并记下这最后一份，中间值没有意义，不在队列里堆积。 */
        const commitLatest = <T>(field: PersistedField<T>, value: T): void => {
            if (paused(field as PersistedField<unknown>)) {
                field.show(value);
                latest.set(field as PersistedField<unknown>, () => void field.commit(() => value));
                return;
            }
            void field.commit(() => value);
        };

        return {
            state: {preferences, expanded, userExpanded},
            actions: {
                setShowManifests: (show: boolean): void => commitLatest(preferences, {showManifests: show}),
                saveExpanded: (record: ExpandedRecord, paths: ReadonlyArray<string>): void => {
                    const field = record === "expanded" ? expanded : userExpanded;
                    if (field === null) return;
                    const current = field.display.paths;
                    if (current.length === paths.length && current.every((path, index) => path === paths[index])) return;
                    commitLatest(field, {paths: [...paths]});
                },
                /** 重试暂停的保存；打开失败或订阅结束的记录先重新打开。之后提交暂停期间记下的最后一份展开。 */
                retry: async (): Promise<void> => {
                    for (const field of fields) {
                        // 重开成功后同一次动作里接着重试暂停的队首（首读失败期间的修改就停在那里）。
                        if (field.failure !== null) await field.reopen();
                        if (field.failure === null && paused(field as PersistedField<unknown>)) await field.retry();
                    }
                    for (const [field, commit] of [...latest]) {
                        if (paused(field)) continue;
                        latest.delete(field);
                        commit();
                    }
                },
                /** 放弃没保存上的修改：显示回到已保存的值。 */
                discard: (): void => {
                    latest.clear();
                    for (const field of fields) if (paused(field as PersistedField<unknown>)) field.discardAll();
                },
            },
        };
    });
}

const BOUND = defineExplorerStore(true);
const UNBOUND = defineExplorerStore(false);

/** 绑定了项目的窗口才有项目树的展开记录（project 作用域的记录要有项目）。 */
export function explorerStoreFor(bound: boolean): typeof BOUND {
    return bound ? BOUND : UNBOUND;
}

export type ExplorerStore = ReturnType<typeof BOUND.create>;

type FieldView = {readonly failure: string | null; readonly base: {readonly status: string} | null; readonly save: {readonly state: string; readonly code?: string}};

/** 一份字段此刻的问题；没有为 null。 */
export function fieldProblem(field: FieldView): PreferenceProblem | null {
    if (field.failure !== null) return {kind: "unread", code: field.failure};
    if (field.base !== null && (field.base.status === "corrupt" || field.base.status === "unsupported-version")) return {kind: "protected", code: field.base.status};
    if ((field.save.state === "failed" || field.save.state === "unknown") && field.save.code !== undefined) return {kind: "unsaved", code: field.save.code};
    return null;
}

