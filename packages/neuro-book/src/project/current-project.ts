/**
 * 项目实例里的当前项目：项目宿主以本地能力提供给 `project` 位置的插件。项目目录的真实路径只在项目子进程
 * 与服务端里，不发给浏览器（docs/specs/runtime/projects.md 输出第 4 条）。服务键由项目宿主在装配时交给
 * 需要它的插件工厂。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

export interface CurrentProject {
    readonly id: string;
    readonly name: string;
    readonly generation: number;
    /** 项目目录的真实路径。 */
    readonly root: string;
}

export const currentProjectKey: ServiceKey<CurrentProject> = defineServiceKey<CurrentProject>("nbook/current-project");
