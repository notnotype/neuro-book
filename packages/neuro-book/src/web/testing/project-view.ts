/**
 * 测试插件 `test.project-view` 的浏览器入口（`src/shared/testing/project-view-contract.ts`）：内置容器“项目”里的第二个侧栏视图，
 * 声明同以前的会话面板（侧栏、`order` 50、`fill`）。内容是一个搜索框和几行字，e2e 用它测焦点与滚动。
 */

import {defineComponent, h} from "vue";

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {PROJECT_VIEW_CONTAINER, WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/views";
import type {ViewDeclaration} from "nbook/plugins/workbench/shared/views";
import {PROJECT_TEST_VIEW, projectViewDescriptor} from "nbook/shared/testing/project-view-contract";

const DECLARATION: ViewDeclaration = {title: {"zh-CN": "项目列表", "en-US": "Project list"}, icon: "i-lucide-messages-square", location: "sidebar", order: 50, layout: "fill", container: PROJECT_VIEW_CONTAINER};

const ProjectTestView = defineComponent({
    name: "ProjectTestView",
    setup: () => () => h("div", {"data-project-test-view": "", style: "display: flex; flex-direction: column; gap: 4px; padding: 8px"}, [
        h("input", {"aria-label": "搜索", "data-project-test-search": ""}),
        ...["第一行", "第二行", "第三行"].map((line) => h("p", {}, line)),
    ]),
});

export function createProjectViewBrowserPlugin(): PluginDefinition {
    return {
        id: projectViewDescriptor.id,
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            contributions: [{capability: WORKBENCH_VIEWS_POINT, id: PROJECT_TEST_VIEW, declaration: DECLARATION}],
            activate: () => ({contributions: {[WORKBENCH_VIEWS_POINT]: {[PROJECT_TEST_VIEW]: {load: async () => ProjectTestView}}}}),
        }],
    };
}
