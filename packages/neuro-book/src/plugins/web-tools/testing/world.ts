/**
 * `nbook.web-tools` 的测试场地：在 Agent 的场地（真实服务端、设置文件、会话与 eval 子进程，`agent/testing/world.ts`）上按产品宿主的
 * 装法装本插件，DeepSeek 的地址指向测试给的本机假接口；另给一个窗口经真实远程合同调设置页的方法。只由测试使用。
 */

import {join} from "node:path";

import {defineProfile} from "@notnotype/nb-harness/kernel";
import type {SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {definitionAt} from "nbook/manifest";
import {agentProfile} from "nbook/plugins/agent/shared/points";
import {localModelSettings} from "nbook/plugins/agent/testing/endpoint";
import {agentWorld} from "nbook/plugins/agent/testing/world";
import type {AgentWorld} from "nbook/plugins/agent/testing/world";

import {webBackendPlugin} from "../backend/plugin";
import {descriptor} from "../plugin";
import {webSettingsContract} from "../shared/contracts";

/** 场地里的 Profile：只写 eval 与 read，两个网页工具经 `defaultForAll` 进来（docs/specs/web/tools.md 输出 20）。 */
export const WEB_TEST_PROFILE = "test.web.profile";

const useSettings = (context: ActivationContext) => context.remote.use(webSettingsContract);
export type WebSettingsClient = ReturnType<typeof useSettings>;

export interface WebWorld {
    readonly agent: AgentWorld;
    readonly keysPath: string;
    /** 新建一个用测试 Profile 的会话。 */
    open(): Promise<SessionApi>;
    /** 起一个窗口，交回它的 `nbook.web-tools/settings` 客户端。 */
    settings(id: string): Promise<WebSettingsClient>;
    close(): Promise<void>;
}

function profilePlugin(): PluginDefinition {
    const declared = agentProfile(WEB_TEST_PROFILE, {name: WEB_TEST_PROFILE, description: "网页工具的测试", tools: {required: ["nbook.agent.eval", "nbook.agent.read"], optional: []}});
    return {id: "test.web", entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup", declared.activationEvent],
        contributions: [declared.contribution],
        activate: () => ({contributions: {"agent.profiles": {[WEB_TEST_PROFILE]: defineProfile({id: WEB_TEST_PROFILE, version: "1", name: WEB_TEST_PROFILE, description: "网页工具的测试", system: "测试。", tools: {required: ["nbook.agent.eval", "nbook.agent.read"]}})}}}),
    })]};
}

export async function webWorld(root: string, options: {readonly deepseekBaseUrl: string; readonly modelBaseUrl: string; readonly userSettings?: Readonly<Record<string, unknown>>}): Promise<WebWorld> {
    const agent = await agentWorld(root, {
        plugins: [definitionAt("server", descriptor, webBackendPlugin), profilePlugin()],
        userSettings: {
            ...localModelSettings(options.modelBaseUrl),
            "nbook.web-tools/deepseekBaseUrl": options.deepseekBaseUrl,
            "nbook.agent/profileSettings": {[WEB_TEST_PROFILE]: {approvalMode: "yolo"}},
            ...options.userSettings,
        },
    });
    let windows = 0;
    return {
        agent,
        keysPath: join(agent.stateRoot, "web", "keys.json"),
        open: async () => {
            const created = await agent.service.create({profile: WEB_TEST_PROFILE});
            if (!created.ok) throw new Error(`session not created: ${created.code}`);
            return created.value;
        },
        settings: async (id) => {
            windows += 1;
            let captured: ActivationContext | null = null;
            const page: PluginDefinition = {id: `test.web-page-${String(windows)}`, entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], activate: (context) => {
                captured = context;
                return {};
            }})]};
            await agent.settings.window(id, [page], {bound: false});
            if (captured === null) throw new Error("the test page did not activate");
            return useSettings(captured);
        },
        close: () => agent.close(),
    };
}
