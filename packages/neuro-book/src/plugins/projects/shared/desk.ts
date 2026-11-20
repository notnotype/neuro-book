/**
 * 书架案头的贡献位（docs/specs/workbench/bookshelf.md 输出 2、22）：别的插件往看板娘那一格上叠自己的入口。声明是纯数据，前后端都能
 * 引用；实现（`load()` 交回组件）在 `web/desk.ts`。书架插件不认识贡献方，依赖方向是“贡献方 → 书架插件”。
 */

import type {ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";

export const PROJECTS_DESK_POINT = "projects.desk";

export const deskPoint: ContributionPointDefinition<Record<string, never>> = {
    id: PROJECTS_DESK_POINT,
    implementation: "required",
    idPrefix: "plugin",
    validate: (descriptor) => (descriptor.location === "browser" ? null : `${PROJECTS_DESK_POINT} 只接受浏览器入口的贡献`),
};
