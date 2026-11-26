/**
 * `nbook.web` 的测试场地：在 Agent 的场地（真实服务端、设置文件、会话与 eval 子进程，`agent/testing/world.ts`）上按产品宿主的
 * 装法装本插件，DeepSeek 与 Tavily 的地址指向测试给的本机假接口；另给一个窗口经真实远程合同调设置页的方法。只由测试使用。
 */

import {join} from "node:path";

import {defineProfile} from "@notnotype/nb-harness/kernel";
import type {SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {definitionAt} from "nbook/manifest";
import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import type {SettingsService} from "nbook/shared/settings";
import {agentProfile} from "nbook/plugins/agent/shared/points";
import {localModelSettings} from "nbook/plugins/agent/testing/endpoint";
import {agentWorld} from "nbook/plugins/agent/testing/world";
import type {AgentWorld} from "nbook/plugins/agent/testing/world";

import {createWebBackendPlugin, webBackendPlugin} from "../backend/plugin";
import type {KeyStoreFactory} from "../backend/plugin";
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
    /** 起一个窗口，交回它的 `nbook.web/settings` 客户端。 */
    settings(id: string): Promise<WebSettingsClient>;
    /** 起一个窗口，交回远程合同的客户端与窗口的设置服务（设置页经它写“使用”哪家）。 */
    window(id: string): Promise<{readonly remote: WebSettingsClient; readonly settings: SettingsService}>;
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

export async function webWorld(root: string, options: {
    readonly deepseekBaseUrl: string;
    /** 缺省指向一个不会有人监听的本机地址：只测 DeepSeek 的用例不该发到 Tavily。 */
    readonly tavilyBaseUrl?: string;
    readonly modelBaseUrl: string;
    readonly userSettings?: Readonly<Record<string, unknown>>;
    /** 换掉密钥文件（例如让读密钥停在测试控制的地方）；缺省用产品的插件定义。 */
    readonly keyStore?: KeyStoreFactory;
}): Promise<WebWorld> {
    const plugin = options.keyStore === undefined ? webBackendPlugin : createWebBackendPlugin(options.keyStore);
    const agent = await agentWorld(root, {
        plugins: [definitionAt("server", descriptor, plugin), profilePlugin()],
        userSettings: {
            ...localModelSettings(options.modelBaseUrl),
            "nbook.web/deepseekBaseUrl": options.deepseekBaseUrl,
            "nbook.web/tavilyBaseUrl": options.tavilyBaseUrl ?? "http://127.0.0.1:9/",
            "nbook.agent/profileSettings": {[WEB_TEST_PROFILE]: {approvalMode: "yolo"}},
            ...options.userSettings,
        },
    });
    const window = async (id: string): Promise<{readonly remote: WebSettingsClient; readonly settings: SettingsService}> => {
        let captured: ActivationContext | null = null;
        // 用本插件的 id 与描述：设置服务只让插件写自己声明的项，产品里写“使用”的是本插件的浏览器入口（设置页）。
        const page: PluginDefinition = {id: descriptor.id, entries: [defineEntry({id: "browser", location: "browser", dependencies: [{key: settingsKey}], activationEvents: ["onStartup"], activate: (context) => {
            captured = context;
            return {};
        }})]};
        await agent.settings.window(id, [definitionAt("browser", descriptor, page)], {bound: false});
        if (captured === null) throw new Error("the test page did not activate");
        const context: ActivationContext = captured;
        return {remote: useSettings(context), settings: context.services.require(settingsKey)};
    };
    return {
        agent,
        keysPath: join(agent.stateRoot, "web", "keys.json"),
        open: async () => {
            const created = await agent.service.create({profile: WEB_TEST_PROFILE});
            if (!created.ok) throw new Error(`session not created: ${created.code}`);
            return created.value;
        },
        settings: async (id) => (await window(id)).remote,
        window,
        close: () => agent.close(),
    };
}
