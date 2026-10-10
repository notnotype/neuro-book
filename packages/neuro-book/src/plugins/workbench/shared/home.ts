/**
 * 无项目首页的贡献点（docs/specs/ui/workbench-shell.md 输出 36）：没有绑定项目的窗口打开 `/` 时，外壳换成首页贡献的
 * 内容。声明是纯数据，前后端都能引用；实现（`load()`）在 `web/contracts.ts`。工作台不认识书架插件，依赖方向是
 * “书架插件 → 工作台”。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {ContributionDescriptor} from "@notnotype/nb-runtime/plugins";

import {LocalizedTextSchema} from "nbook/shared/localized-text";

export const WORKBENCH_HOME_POINT = "workbench.home";

export const HomeDeclarationSchema = Type.Object({
    /** 首页的名字：诊断与文档标题用它。 */
    title: LocalizedTextSchema,
}, {additionalProperties: false});

export type HomeDeclaration = Static<typeof HomeDeclarationSchema>;

/** 只看这一条声明本身；几个首页同时在时的裁决在接收者（全部不采用，记诊断）。 */
export function validateHomeContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${WORKBENCH_HOME_POINT} 只接受浏览器入口的贡献`;
    if (!Value.Check(HomeDeclarationSchema, descriptor.declaration)) {
        const first = [...Value.Errors(HomeDeclarationSchema, descriptor.declaration)][0];
        return `首页 ${descriptor.id} 的声明不合格：${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}：${first.message}`}`;
    }
    return null;
}
