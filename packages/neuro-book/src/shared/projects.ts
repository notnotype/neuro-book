/**
 * 项目管理的共用类型：服务端宿主的项目管理、宿主能力 `projectsKey` 与 `nbook.projects` 的合同都用它们。
 * 行为合同见 docs/specs/runtime/projects.md。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

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

/** 目录校验的失败：登记的目录与新建作品的父目录用同一套判据。 */
export type ProjectDirectoryFailure = Extract<ProjectRegisterFailure, "invalid-path" | "not-directory" | "not-accessible" | "inside-state-root">;

/**
 * 身份文件里的作品信息（docs/specs/runtime/projects.md 输出第 13 条）；没有或不合规的字段为 null。形状与
 * `nbook.projects` 合同里的 `ProjectMetadataSchema` 相同，宿主这边不引用插件。
 */
export interface ProjectMetadata {
    readonly title: string | null;
    readonly description: string | null;
    readonly color: string | null;
}

export type ProjectMetadataField = keyof ProjectMetadata;

/** 修改作品信息：给出的字段才改，`null` 清除，省略不动。 */
export type ProjectMetadataPatch = {readonly [Field in ProjectMetadataField]?: string | null};

/** 身份文件里一个不合规、被当作没有的字段；读取方据此记诊断 `project.metadata.invalid`。 */
export interface ProjectMetadataProblem {
    readonly field: ProjectMetadataField;
    readonly detail: string;
}

/** 读某个已登记项目的作品信息；身份文件读不出（不存在、坏掉、与登记表的 id 不符或读盘出错）时给出原因。 */
export type ProjectMetadataRead =
    | {readonly ok: true; readonly metadata: ProjectMetadata; readonly problems: ReadonlyArray<ProjectMetadataProblem>}
    | {readonly ok: false; readonly reason: "unknown-project" | "registry-invalid" | "identity-invalid" | "identity-conflict" | "read-failed"; readonly detail: string};

/** 作品信息某个字段不合规（书名、简介、主题色的规则见输出第 13 条）。 */
export type ProjectMetadataInvalid = {readonly ok: false; readonly reason: "invalid-metadata"; readonly field: ProjectMetadataField; readonly detail: string};

export type ProjectUpdateResult =
    | {readonly ok: true; readonly metadata: ProjectMetadata}
    | ProjectMetadataInvalid
    | {readonly ok: false; readonly reason: "unknown-project" | "registry-invalid" | "identity-invalid" | "identity-conflict" | "read-only" | "write-failed"; readonly detail: string};

/**
 * 新建作品的输入。`parent` 必填：作品目录是 `nbook.projects` 的设置，宿主不读插件的配置，由调用方在 `parent` 省略时
 * 读设置、都没有时自己给出 `no-library`（输出第 14 条）。
 */
export interface ProjectCreateInput {
    readonly title: string;
    readonly description?: string;
    readonly parent: string;
}

/**
 * 新建作品的结果，按阶段（输出第 14 条）：
 * - `invalid-metadata`、`invalid-parent`：什么也没建；
 * - `exists`：由书名生成的目录已存在，不碰它；
 * - `write-failed`：建目录或写身份文件失败，只装着本次写的东西的目录已删掉；
 * - `register-failed`：目录与身份文件已建好、保留，`cause` 是登记的失败码；再登记 `path` 按幂等规则接着完成。
 */
export type ProjectCreateResult =
    | {readonly ok: true; readonly project: ProjectRecord}
    | ProjectMetadataInvalid
    | {readonly ok: false; readonly reason: "invalid-parent"; readonly cause: ProjectDirectoryFailure; readonly detail: string}
    | {readonly ok: false; readonly reason: "exists"; readonly path: string; readonly detail: string}
    | {readonly ok: false; readonly reason: "write-failed"; readonly detail: string}
    | {readonly ok: false; readonly reason: "register-failed"; readonly cause: ProjectRegisterFailure; readonly path: string; readonly detail: string};

/** 读登记表的结果；登记表无法解析时不覆盖它，读与写都以 `registry-invalid` 失败。 */
export type ProjectRegistryRead<T> = {readonly ok: true; readonly value: T} | {readonly ok: false; readonly reason: "registry-invalid"; readonly detail: string};

export type ProjectRunState = "stopped" | "starting" | "running" | "idle-grace" | "stopping";

/** 已登记项目与它的运行状态。 */
export interface ProjectState extends ProjectRecord {
    readonly state: ProjectRunState;
    /** 运行中（含启动与停止中）的代次；没在运行为 null。 */
    readonly generation: number | null;
    /** 当前代次的子进程；没在运行为 null。 */
    readonly pid: number | null;
}

/** 某个项目代次的一份租约：持有期间这一代不会因宽限期满而停止。 */
export interface ProjectLease {
    readonly id: string;
    readonly name: string;
    readonly generation: number;
    /** 这一代结束（停止、崩溃、强制结束）时触发，租约随之失效。 */
    readonly revoked: AbortSignal;
    /** 释放租约；幂等。 */
    release(): void;
}

export type ProjectAcquireResult =
    | {readonly status: "acquired"; readonly lease: ProjectLease}
    | {readonly status: "rejected"; readonly reason: "unknown-project" | "registry-invalid" | "admission-closed" | "create-failed" | "generation-gone"; readonly detail: string};

/** 移出书架的结果；`project-running` 带被拒时的状态（输出第 15 条）。 */
export type ProjectUnregisterResult =
    | {readonly ok: true; readonly project: ProjectRecord}
    | {readonly ok: false; readonly reason: "unknown-project" | "registry-invalid" | "write-failed"; readonly detail: string}
    | {readonly ok: false; readonly reason: "project-running"; readonly state: Exclude<ProjectRunState, "stopped">; readonly detail: string};

/**
 * 宿主能力 `projectsKey`：服务端插件在入口依赖里声明它就能用。按调用方门面提供：每个调用方入口的每次激活
 * 各得一个门面，`acquire` 取得的租约记在这次激活名下，入口停止时一并释放（docs/specs/runtime/projects.md 输出第 8 条）。
 */
export interface ProjectsService {
    list(): Promise<ProjectRegistryRead<ReadonlyArray<ProjectState>>>;
    register(path: string): Promise<ProjectRegisterResult>;
    resolve(reference: string): Promise<ProjectRegistryRead<ProjectRecord | null>>;
    /** 取得项目的租约；项目没在运行就以新代次启动它。 */
    acquire(reference: string): Promise<ProjectAcquireResult>;
    /** 读已登记项目（按 id）的作品信息；不打开项目。 */
    readMetadata(id: string): Promise<ProjectMetadataRead>;
    /** 新建作品目录、写身份文件（含书名与简介）并登记（输出第 14 条）。 */
    create(input: ProjectCreateInput): Promise<ProjectCreateResult>;
    /** 修改已登记项目（按 id）的作品信息：加锁替换身份文件，核对文件里的 id 与登记表一致（输出第 13 条）。 */
    updateMetadata(id: string, patch: ProjectMetadataPatch): Promise<ProjectUpdateResult>;
    /**
     * 移出书架（按 id）：只改登记表，不动目录与身份文件。与同一 id 的打开串行；项目不在 `stopped` 时拒绝，只针对本服务端
     * 进程管理的代次（输出第 15 条）。
     */
    unregister(id: string): Promise<ProjectUnregisterResult>;
}

/** 服务端宿主以本地能力提供；需要它的插件在入口依赖里声明。 */
export const projectsKey: ServiceKey<ProjectsService> = defineServiceKey<ProjectsService>("nbook/projects");

/** 窗口绑定的项目：握手时由服务端决定，窗口一生不变（docs/specs/runtime/browser-host.md 启动序列第 5 步）。 */
export interface WindowProject {
    /** 没有绑定项目的窗口为 null。 */
    readonly project: {readonly id: string; readonly name: string; readonly generation: number} | null;
}

/** 浏览器宿主以本地能力提供给本窗口的插件；需要它的插件在入口依赖里声明。 */
export const windowProjectKey: ServiceKey<WindowProject> = defineServiceKey<WindowProject>("nbook/window-project");

/**
 * 项目实例里的当前项目：项目宿主以本地能力提供给 `project` 位置的插件。项目目录的真实路径只在项目子进程
 * 与服务端里，不发给浏览器（docs/specs/runtime/projects.md 输出第 4 条）。
 */
export interface CurrentProject {
    readonly id: string;
    readonly name: string;
    readonly generation: number;
    /** 项目目录的真实路径。 */
    readonly root: string;
}

/** 项目宿主提供；本代次内不变。 */
export const currentProjectKey: ServiceKey<CurrentProject> = defineServiceKey<CurrentProject>("nbook/current-project");
