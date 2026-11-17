/**
 * 方言声明的贡献点（docs/specs/workspace/markdown-syntaxes.md）、属性声明的贡献点（`properties.ts`）与项目位置的 `nbook.markdown` 定义：项目进程里只有这个贡献点、
 * 没有入口（同 `nbook.settings` 的 `settings/shared/point.ts`），顶层声明在那里也有拥有者，书架统计才查得到它们。
 */

import type {ContributionPointDefinition, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {descriptor} from "../plugin";
import {MARKDOWN_DIALECTS_POINT, validateDialectDeclaration} from "./dialects";
import type {DialectDeclaration} from "./dialects";
import {propertiesPoint} from "./properties";

export const dialectsPoint: ContributionPointDefinition<DialectDeclaration> = {id: MARKDOWN_DIALECTS_POINT, implementation: "none", validate: validateDialectDeclaration};

export const markdownProjectPlugin: PluginDefinition = {id: descriptor.id, contributionPoints: [dialectsPoint, propertiesPoint], entries: []};
