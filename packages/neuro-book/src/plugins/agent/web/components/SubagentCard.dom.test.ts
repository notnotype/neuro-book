/**
 * SubagentCard（同名 .md，docs/specs/agent/conversation.md 输出 33）：运行中那一行与“等你批准”写注册表里的动作名，
 * 不写工具 id。注册表与对话位置的组件用的是同一份（内置工具加子代理工具），按真实的注入取。
 */

import {createAgentViewRegistry} from "@notnotype/nb-agent-ui";
import {builtinContributions} from "@notnotype/nb-agent-ui/vue";
import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import type {TreeItem} from "nbook/plugins/agent/shared/subagents";
import {CARD_SAMPLES, sampleProps, sampleStore} from "nbook/plugins/agent/web/lab/subagent-samples";
import type {CardSample} from "nbook/plugins/agent/web/lab/subagent-samples";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {AGENT_TEXT_NAMESPACE} from "../../shared/text";
import {subagentContribution} from "../subagent-renderers";
import {subagentStoreKey, toolActionKey, toolActionOf} from "../subagent-store";
import {agentCatalogs} from "../text";
import SubagentCard from "./SubagentCard.vue";

const port = testTextPort("zh-CN", {[AGENT_TEXT_NAMESPACE]: agentCatalogs});
const registry = createAgentViewRegistry([...builtinContributions, subagentContribution({card: SubagentCard})]);

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function lineOf(sample: CardSample, options: {actions?: boolean} = {}): string {
    const provide = {...provideText(port), [subagentStoreKey as symbol]: sampleStore(sample), ...(options.actions === false ? {} : {[toolActionKey as symbol]: (tool: string) => toolActionOf(registry, tool)})};
    const wrapper = mount(SubagentCard, {global: {provide}, props: sampleProps(sample)});
    mounted.push(wrapper);
    return wrapper.get("[data-subagent-line]").text();
}

/** 运行中的样本，换掉最近一步。 */
const runningWith = (step: TreeItem["step"]): CardSample => ({...CARD_SAMPLES.running!, tree: CARD_SAMPLES.running!.tree.map((item) => ({...item, step}))});

describe("SubagentCard 的动作名", () => {
    it("运行中写动作名与对象，地址只写最后一段；注册表里没有的工具写工具名", () => {
        expect(lineOf(runningWith({tool: "nbook.agent.read", target: "project://正文/第二章.md"}))).toBe("读取 第二章.md");
        expect(lineOf(runningWith({tool: "nbook.agent.edit-replace", target: "project://正文/第三章.md"}))).toBe("编辑 第三章.md");
        expect(lineOf(runningWith({tool: "lab.publish_chapter", target: "project://正文/第五章.md"}))).toBe("publish_chapter 第五章.md");
        // 子代理自己的工具按显式映射的键查，写本插件登记的名称。
        expect(lineOf(runningWith({tool: "nbook.agent.spawn"}))).toBe("派子代理");
    });

    it("等你批准写动作名", () => {
        expect(lineOf(CARD_SAMPLES.waiting!)).toBe("等你批准：写入");
    });

    it("没有提供动作名（单独挂载）时写工具名", () => {
        expect(lineOf(runningWith({tool: "nbook.agent.read", target: "project://正文/第二章.md"}), {actions: false})).toBe("read 第二章.md");
    });
});
