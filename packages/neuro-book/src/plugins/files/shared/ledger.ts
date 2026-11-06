/**
 * 记账槽（docs/specs/workspace/resources.md 的“记账槽”）：`nbook.files` 定义的贡献点，文件写入成功后在提交的锁里把改前改后
 * 交给贡献的记账者（History）。至多一个贡献者；没有、撤回、出错或超时都不影响写入。形状在接入 History 时还会改，所以
 * 不进插件 SDK。这里只有类型，不引 Node。
 */

import type {ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";

import type {ChangeGroup, ChangeSource} from "./contracts";

export const LEDGER_POINT = "files.ledger";

/** 贡献 id 按插件 id 取前缀（由内核核对）：别的插件不能冒用记账者的名字。 */
export const ledgerPoint: ContributionPointDefinition<Record<string, never>> = {id: LEDGER_POINT, implementation: "required", idPrefix: "plugin"};

/** 一版内容：`bytes` 只在不超过 32 MB 时给。 */
export interface LedgerContent {
    readonly hash: string;
    readonly bytes: Uint8Array | null;
}

export interface LedgerEntry {
    /** 这条记录的 id（UUID）。 */
    readonly id: string;
    /** 这个根里单调递增的序号：记账者按它排序去重，超时之后迟到的记录也能放回原位。 */
    readonly seq: number;
    readonly root: "project" | "user";
    /** 相对根的真实路径。 */
    readonly path: string;
    readonly op: "write" | "created";
    readonly before: LedgerContent | null;
    readonly after: LedgerContent;
    readonly source: ChangeSource;
    readonly group?: ChangeGroup;
}

export interface Ledger {
    /** Files 至多等 2 秒；`signal` 在超时或入口停止时触发，之后的完成被忽略。 */
    record(entry: LedgerEntry, signal: AbortSignal): Promise<void>;
}
