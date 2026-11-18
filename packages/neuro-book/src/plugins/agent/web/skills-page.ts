/**
 * “Skill”页的包装（docs/specs/agent/skills.md 输出 25、27）：页面组件只吃目录，能在 Lab 里直接摆；这里接窗口的 Skill 目录、页自己的
 * 确认框，打开 `SKILL.md` 与 Skill 文件夹。打不开文件夹时发一条通知写出路径。
 */

import {defineComponent, h} from "vue";
import type {Component, PropType} from "vue";

import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import type {NotificationInput} from "nbook/plugins/workbench/shared/contracts";

import type {agentSessionsContract} from "../shared/remote";
import type {SkillEntry} from "../shared/skills";
import {agentText} from "../shared/text";
import SkillInitDialog from "./components/SkillInitDialog.vue";
import {createSkillInit} from "./skill-init";
import type {SkillsClient} from "./skills";

/** 页里“打开”要打开的文件：用户的经 `user://skills/`（能改），其余经 `skills://`（只读）；下一层才有 `SKILL.md` 的打开那一层的。 */
export function skillFileAddress(entry: SkillEntry): string {
    if (entry.source !== "user") return entry.location;
    const nested = entry.problem?.code === "nested" ? `${entry.problem.directory}/` : "";
    return `user://skills/${entry.name}/${nested}SKILL.md`;
}

export function skillsPage(component: Component, deps: {
    readonly skills: SkillsClient;
    readonly remote: Pick<RemoteClient<typeof agentSessionsContract>, "skillInitPlan" | "initSkill" | "openSkillsFolder">;
    readonly openAddress: (address: string) => void;
    readonly notify: (input: NotificationInput) => void;
    readonly report: (code: string, message: string) => void;
}): Component {
    return defineComponent({
        name: "SkillsSettingsHost",
        props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
        setup: () => {
            deps.skills.ensure();
            // 页自己的确认框：与对话位置的那份互不影响，两处可以各开各的。
            const init = createSkillInit(deps.remote, (message) => deps.report("skill-init-failed", message));
            const entryOf = (id: string) => deps.skills.entries.value?.find((entry) => entry.id === id);
            const openFolder = async (): Promise<void> => {
                const opened = await deps.remote.openSkillsFolder({});
                if (opened.ok) return;
                if (opened.code !== "no-desktop" && opened.code !== "open-failed") {
                    deps.report("skills-folder-failed", opened.code);
                    return;
                }
                const message = opened.code === "no-desktop" ? agentText("skills.page.folder.noDesktop", {path: opened.detail.path}) : agentText("skills.page.folder.failed", {path: opened.detail.path});
                deps.notify({tone: "warning", title: agentText("skills.page.folder.title"), message, ...(opened.code === "open-failed" ? {detail: opened.detail.detail} : {})});
            };
            return () => [
                h(component, {
                    entries: deps.skills.entries.value,
                    onInit: (id: string) => {
                        const entry = entryOf(id);
                        if (entry !== undefined) void init.ask(entry);
                    },
                    onOpen: (id: string) => {
                        const entry = entryOf(id);
                        if (entry !== undefined) deps.openAddress(skillFileAddress(entry));
                    },
                    onOpenFolder: () => void openFolder(),
                }),
                h(SkillInitDialog, {
                    open: init.state.value.open,
                    name: init.state.value.name,
                    phase: init.state.value.phase,
                    plan: init.state.value.plan,
                    failure: init.state.value.failure,
                    "onUpdate:open": (open: boolean) => {
                        if (!open) init.close();
                    },
                    onConfirm: () => void init.confirm(),
                }),
            ];
        },
    });
}
