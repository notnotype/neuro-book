/**
 * 测试插件 `test.project-view` 的描述：只由测试引用。它只有浏览器入口，提供一个声明在内置容器“项目”里的侧栏视图，和以前的会话面板
 * （`nbook.agent.sessions`，t15 阶段 ② 并进消息视图）的声明一样：工作台的 e2e 要“项目”容器里有资源管理器之外的第二个分节。
 * 宿主测试入口按 `NBOOK_TEST_PLUGINS` 把描述加进本进程清单。
 */

import type {PluginDescriptor} from "nbook/manifest";

export const projectViewDescriptor: PluginDescriptor = {id: "test.project-view", version: "0.1.0", locations: ["browser"]};

/** 那个视图的 id。 */
export const PROJECT_TEST_VIEW = "test.project-view.list";
