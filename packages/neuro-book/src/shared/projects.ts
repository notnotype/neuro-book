/**
 * 项目管理的共用类型：服务端宿主的项目管理、宿主能力 `projectsKey` 与 `nbook.projects` 的合同都用它们。
 * 行为合同见 docs/specs/runtime/projects.md。
 */

/** 登记表里的一个项目。`path` 是用户登记的项目目录（真实路径），可以显示给用户。 */
export interface ProjectRecord {
    readonly id: string;
    readonly name: string;
    readonly path: string;
}

export type ProjectRegisterFailure =
    | "invalid-path"
    | "not-directory"
    | "not-accessible"
    | "inside-state-root"
    | "identity-invalid"
    | "identity-conflict"
    | "registry-invalid"
    | "write-failed";

export type ProjectRegisterResult =
    | {readonly ok: true; readonly project: ProjectRecord}
    | {readonly ok: false; readonly reason: ProjectRegisterFailure; readonly detail: string};

/** 读登记表的结果；登记表无法解析时不覆盖它，读与写都以 `registry-invalid` 失败。 */
export type ProjectRegistryRead<T> = {readonly ok: true; readonly value: T} | {readonly ok: false; readonly reason: "registry-invalid"; readonly detail: string};
