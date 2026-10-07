/**
 * “打开项目”（`nbook.projects.open`）：列出已登记项目，选中即整页导航到 `/?project=<短名>`；输入目录路径则先
 * 登记再导航。窗口一生只绑定一个项目，切换项目就是重新加载（docs/specs/runtime/projects.md 输出第 10 条）。
 * 登记失败时带着原因重新打开选择，用户可以改了再试或取消；命令系统那边的失败只给远程服务不可用这类情形。
 */

import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import type {CommandDeclaration, CommandResult} from "nbook/plugins/commands/shared/contracts";
import type {QuickPick, QuickPickRequest} from "nbook/plugins/workbench/web/contracts";

import {OPEN_PROJECT_COMMAND, projectsRemoteContract} from "../shared/contracts";
import type {ProjectView} from "../shared/contracts";
import {projectsText} from "./messages";

export {OPEN_PROJECT_COMMAND};

export const OPEN_PROJECT_DECLARATION: Omit<CommandDeclaration, "args"> = {
    title: {"zh-CN": "打开项目", "en-US": "Open Project"},
    category: {"zh-CN": "项目", "en-US": "Project"},
    description: "Open a registered project in this window, or register a directory as a project and open it. The page reloads.",
    effect: "write",
    // 整页重新加载会打断 Agent 自己所在的窗口；先只给人用。
    expose: {agent: "never"},
};

/** 打开某个项目的地址：短名写在地址栏，切换项目即整页加载。 */
export function projectUrl(name: string): string {
    return `/?project=${encodeURIComponent(name)}`;
}

const ACTIVE_STATES: ReadonlySet<ProjectView["state"]> = new Set(["starting", "running", "idle-grace"]);

function request(projects: ReadonlyArray<ProjectView>, title: string): QuickPickRequest {
    return {
        title,
        placeholder: projectsText("placeholder"),
        items: projects.map((project) => ({id: project.name, label: project.name, detail: ACTIVE_STATES.has(project.state) ? `${project.path} · ${projectsText("running")}` : project.path})),
        text: {label: (path) => projectsText("registerAndOpen", {path})},
        empty: projectsText("empty"),
    };
}

export async function openProject(remote: RemoteClient<typeof projectsRemoteContract>, quickPick: QuickPick, navigateDocument: (url: string) => void): Promise<CommandResult<null>> {
    const listed = await remote.list({});
    if (!listed.ok) return {ok: false, code: "unavailable", reason: `列不出已登记的项目：${listed.code}`};
    let title = projectsText("title");
    for (;;) {
        const picked = await quickPick.pick(request(listed.value, title));
        if (picked.kind === "cancelled") return {ok: true, value: null};
        if (picked.kind === "unavailable") return {ok: false, code: "unavailable", reason: picked.reason};
        if (picked.kind === "item") {
            navigateDocument(projectUrl(picked.id));
            return {ok: true, value: null};
        }
        const registered = await remote.register({path: picked.text});
        if (registered.ok) {
            navigateDocument(projectUrl(registered.value.name));
            return {ok: true, value: null};
        }
        if (registered.code !== "register-failed") return {ok: false, code: "unavailable", reason: `登记没有完成：${registered.code}`};
        const failure = registered.detail as {readonly reason: string; readonly detail: string};
        title = projectsText("retryTitle", {reason: failure.detail});
    }
}
