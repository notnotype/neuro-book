/**
 * “权限规则”页的包装（permissions.md 输出 22）：页面组件只吃普通的属性，能在 Lab 里直接摆；这里读配置与项目规则文件，把改动写回用户层，
 * 写失败交给窗口通知。做法同模型设置页（`nbook.models` 的 `pages.ts`）。
 */

import {defineComponent, h, onMounted, shallowRef} from "vue";
import type {Component, PropType} from "vue";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import type {RemoteClient} from "@notnotype/nb-runtime/remote";
import {settingsFailureText} from "nbook/ui/settings/setting-text";
import type {TextResolver} from "nbook/shared/localized-text";
import type {SettingDefinition, SettingsService} from "nbook/shared/settings";

import type {Rule} from "../shared/permissions";
import type {agentSessionsContract} from "../shared/remote";
import {agentSettings} from "../shared/settings";
import {agentText} from "../shared/text";

export function permissionsPage(component: Component, deps: {
    readonly settings: SettingsService;
    readonly remote: Pick<RemoteClient<typeof agentSessionsContract>, "projectPermissionRules">;
    /** 窗口绑定的作品；没有绑定时没有“这本书的规则”。 */
    readonly project: string | null;
    readonly text: TextResolver;
    readonly report: (code: string, message: string) => void;
}): Component {
    return defineComponent({
        name: "PermissionsSettingsPage",
        props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
        setup: (props) => {
            const projectRules = shallowRef<readonly Rule[] | "invalid" | null>(null);
            onMounted(async () => {
                if (deps.project === null) return;
                const result = await deps.remote.projectPermissionRules({project: deps.project});
                if (result.ok) projectRules.value = result.value;
                else deps.report("project-rules-unavailable", result.code);
            });
            const write = <T>(setting: SettingDefinition<T>, value: T): void => {
                void deps.settings.update(setting, value as never).then((result) => {
                    if (result.ok) return;
                    props.context.reportWriteFailure(deps.text.t(agentText("permissions.notSaved")), {reason: settingsFailureText(result.code, result.detail, deps.text), uncertain: result.code === "unknown-outcome"});
                });
            };
            return () => h(component, {
                rules: deps.settings.get(agentSettings.settings.permissionRules),
                projectRules: projectRules.value,
                projectTitle: props.context.projectTitle.value,
                writable: props.context.writable.value,
                modeWriteAction: deps.settings.get(agentSettings.settings.modeWriteAction),
                readOnlyCommands: deps.settings.get(agentSettings.settings.readOnlyCommands),
                onChange: (rules: Rule[]) => write(agentSettings.settings.permissionRules, rules),
                onModeWriteAction: (value: "deny" | "ask") => write(agentSettings.settings.modeWriteAction, value),
                onReadOnlyCommands: (value: string[]) => write(agentSettings.settings.readOnlyCommands, value),
            });
        },
    });
}
