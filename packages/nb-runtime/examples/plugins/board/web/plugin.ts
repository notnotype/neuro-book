/**
 * `example.board` 的浏览器入口：把本窗口绑定的项目的白板包成本地服务 `BoardService`。`.at("project")` 由内核按窗口
 * 的项目绑定解析到那个项目这一代的实例；窗口没有绑定项目时调用得到失败码，不会落到别的项目。
 */

import {provide} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {descriptor} from "../plugin";
import {boardContract, boardKey} from "../shared/contracts";
import type {BoardService} from "../shared/contracts";

export const boardBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [{
        id: "browser",
        location: "browser",
        provides: [boardKey],
        activate: (context) => {
            const project = context.remote.use(boardContract).at("project");
            const board: BoardService = {
                pin: (text) => project.pin({text}),
                items: () => project.items({}),
                watch: (listener, options) => project.events.pinned.subscribe({}, listener, options),
            };
            return {services: [provide(boardKey, board)]};
        },
    }],
};
