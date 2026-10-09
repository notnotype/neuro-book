/**
 * `nbook.editor` 对其它插件公开的合同（docs/specs/workbench/editor.md 的“输入与前置条件”）：文档协调服务，资源管理器
 * 在复制、移动、改名与删除前经它结算未保存的修改。其它插件在运行时只引用本文件。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

/** 需要结算的文档此刻的状态：dirty、在保存、有未裁决输入、磁盘冲突。 */
export type SettleState = "dirty" | "saving" | "unresolved" | "conflict";

export interface AffectedDocument {
    readonly address: string;
    readonly state: SettleState;
}

/** 文件操作期间挡住受影响文档的新保存（保存排队、输入照常）。 */
export interface DocumentLease {
    /**
     * 操作结束：`done` 时成功移动的项按实际目标改地址，租约释放；`unknown`（结果未知）时租约保持，资源管理器核对或
     * 放弃后再以 `done` 结束。重复结束无效。
     */
    end(result: {readonly kind: "done"; readonly moved?: ReadonlyArray<{readonly from: string; readonly to: string}>} | {readonly kind: "unknown"}): void;
}

export type LeaseResult =
    | {readonly ok: true; readonly lease: DocumentLease}
    | {readonly ok: false; readonly reason: "blocked"; readonly documents: ReadonlyArray<AffectedDocument>};

export interface DocumentCoordinator {
    /** 地址本身或其后代里需要结算的文档。 */
    affected(addresses: ReadonlyArray<string>): ReadonlyArray<AffectedDocument>;
    /** 结算这些文档的视图输入、等在途保存，再挡住它们的新保存；有未裁决输入或磁盘冲突时为 blocked，不取租约。 */
    begin(addresses: ReadonlyArray<string>): Promise<LeaseResult>;
    /** 保存这些地址下的 dirty 文档，逐项结果；有未裁决输入或磁盘冲突的项不保存、为失败。 */
    save(addresses: ReadonlyArray<string>): Promise<ReadonlyArray<{readonly address: string; readonly ok: boolean; readonly code?: string}>>;
    /** 本窗口的保存形成了从 `token` 起的目录项身份链时返回链尾的令牌，否则原样返回。 */
    translate(address: string, token: string): string;
    /** 用户确认删除并删除成功后：关闭这些地址及其后代的文档与标签、丢弃正文。 */
    close(addresses: ReadonlyArray<string>): void;
}

export const documentCoordinatorKey: ServiceKey<DocumentCoordinator> = defineServiceKey<DocumentCoordinator>("nbook.editor/documents");
