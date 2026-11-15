/**
 * NeuroBook 的构建预设：通用的构建预设（`src/plugin-platform/build/build-plugin.ts`）绑定 NeuroBook 的平台档案。作者命令、
 * 示例构建与 SDK 包的 `./build` 子路径都用这一层。
 */

import {buildPlugin as buildWithProfile, isPreviousBuild as isPreviousBuildFor} from "../src/plugin-platform/build/build-plugin";
import type {BuildPluginOptions, BuildPluginResult} from "../src/plugin-platform/build/build-plugin";
import {NEUROBOOK_PROFILE} from "../src/plugin-platform-profile";
import {skillsBuild} from "../src/plugins/agent/build/skills";

export {devVersion, PluginBuildError} from "../src/plugin-platform/build/build-plugin";
export type {BuildAlias, BuildPluginOptions, BuildPluginResult} from "../src/plugin-platform/build/build-plugin";

/** NeuroBook 自己的贡献点里要带文件的（Agent 的 Skill），构建时一并打包。 */
const CONTRIBUTION_BUILDS = [skillsBuild];

export function buildPlugin(options: BuildPluginOptions): Promise<BuildPluginResult> {
    return buildWithProfile(NEUROBOOK_PROFILE, options, CONTRIBUTION_BUILDS);
}

export function isPreviousBuild(root: string, outDir: string): Promise<boolean> {
    return isPreviousBuildFor(NEUROBOOK_PROFILE, root, outDir);
}
