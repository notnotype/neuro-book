import type {ResolvedProjectWorkspace} from "nbook/server/workspace-files/project-identity";

/** 谁发起了Project open；用于日志归因、presence与删除占用报告。 */
export type ProjectOpener =
    | {kind: "user"}
    | {kind: "agent"; sessionId: number}
    | {kind: "job"; source: string};

/** 已完成全部required最低ready门禁的ProjectSession generation引用。 */
export type ReadyProjectSessionRef = {
    readonly workspace: ResolvedProjectWorkspace;
    /**
     * 运行期签发、可跨 HTTP 传播的公开标识。
     *
     * 唯一对应本运行期内一个精确 ready 对象；新运行期的 generation 从 1 重新开始时也不能认领旧标识。
     * 它只是代次定位信息，不携带绝对路径、物理 root identity 或锁信息，也不替代鉴权。
     */
    readonly publicId: string;
    readonly generation: number;
};
