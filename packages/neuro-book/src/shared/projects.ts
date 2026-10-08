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
