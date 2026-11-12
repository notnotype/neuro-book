import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

import {appearanceSetting, dragCardShrinkSetting, dragFeelSetting, dropSectorsSetting, dropSplitSetting, themeSetting} from "./shared/contracts";
import {workbenchText} from "./shared/text";
import {BUILTIN_THEME_CONTRIBUTIONS, themesPoint} from "./shared/themes";
import {PROJECT_VIEW_CONTAINER, viewContainersPoint, WORKBENCH_VIEW_CONTAINERS_POINT} from "./shared/views";
import type {ViewContainerDeclaration} from "./shared/views";

/** 侧栏的内置容器“项目”（docs/specs/ui/workbench-layout.md 输出 1）：资源管理器与会话是它的两个分节。 */
const PROJECT_CONTAINER_DECLARATION: ViewContainerDeclaration = {title: workbenchText("viewContainers.project.title"), icon: "i-lucide-folder-kanban", location: "sidebar", order: 0};

/** 工作台：窗口的根界面（外壳与布局、命令面板、产品主题）。主题与明暗两项配置、内置的视图容器在这里声明。 */
export const descriptor: PluginDescriptor = {id: "nbook.workbench", version: PRODUCT_VERSION, locations: ["browser"], contributionPoints: [themesPoint, viewContainersPoint], contributions: [{capability: WORKBENCH_VIEW_CONTAINERS_POINT, id: PROJECT_VIEW_CONTAINER, declaration: PROJECT_CONTAINER_DECLARATION}, themeSetting.contribution, appearanceSetting.contribution, dropSectorsSetting.contribution, dragFeelSetting.contribution, dragCardShrinkSetting.contribution, dropSplitSetting.contribution, ...BUILTIN_THEME_CONTRIBUTIONS]};
