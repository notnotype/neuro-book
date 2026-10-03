// @vitest-environment jsdom
import {createPinia, setActivePinia} from "pinia";
import * as vue from "vue";
import type {App, Component} from "vue";
import {afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {agentRequestUserInputCardScenes} from "./AgentConversation.scenes";
import {LAB_EVENT_SINK, LAB_INPUT_SINK} from "../lab-event-sink";
import type {LabSceneInput} from "../lab-subject";
import type {AgentToolCall} from "../../components/novel-ide/agent/agent-message";

beforeAll(() => {
    const globals = globalThis as typeof globalThis & Record<string, unknown>;
    Object.assign(globals, vue);
    globals.useI18n = () => ({
        t: (key: string, params?: Record<string, unknown>) => {
            const map: Record<string, string> = {
                "agent.userInput.approval": "审批",
                "agent.userInput.decision": "决定",
                "agent.userInput.question": "问题",
                "agent.userInput.answer": "回答",
                "agent.userInput.selected": "已选择",
                "agent.userInput.waitingAnswer": "等待用户回答",
                "agent.userInput.waitingApproval": "等待用户审批",
                "agent.userInput.otherAnswer": "其他答案",
                "agent.userInput.choicePrefix": `选择：${String(params?.text ?? "")}`,
                "agent.userInput.answerPrefix": `回答：${String(params?.text ?? "")}`,
                "agent.userInput.notePrefix": `备注：${String(params?.text ?? "")}`,
                "agent.userInput.noteOptional": "补充说明",
                "agent.userInput.streamingArgs": "参数流式输出中...",
                "agent.userInput.answeredProgress": `已回答 ${String(params?.answered ?? 0)} / ${String(params?.total ?? 0)}`,
                "agent.userInput.expand": "展开",
                "agent.userInput.collapse": "收起",
            };
            return map[key] ?? key;
        },
    });
});

const mounted: App[] = [];

beforeEach(() => {
    setActivePinia(createPinia());
});

afterEach(() => {
    for (const app of mounted.splice(0)) app.unmount();
    document.body.replaceChildren();
});

describe("AgentRequestUserInputCardFixture 场景与只读数据驱动验证", {timeout: 15000}, () => {
    async function mountFixture(scene: string) {
        const {default: Fixture} = await import("./AgentRequestUserInputCardFixture.vue");
        const input = vue.ref<LabSceneInput>(structuredClone(agentRequestUserInputCardScenes.find((entry) => entry.id === scene)!.input));
        const host = document.createElement("div");
        document.body.append(host);
        const app = vue.createApp(vue.defineComponent({
            setup() { return () => vue.h(Fixture as Component, {scene, input: input.value}); },
        }));
        app.use(createPinia());
        app.provide(LAB_INPUT_SINK, (layer, key, value) => {
            input.value = {...input.value, [layer]: {...input.value[layer], [key]: value}};
        });
        app.provide(LAB_EVENT_SINK, () => {});
        mounted.push(app);
        app.mount(host);
        await vue.nextTick();
        return {host, app, input};
    }

    it("正常挂载 pending 场景并标定 data-lab-subject，以只读形态展示待决问题与候选项", async () => {
        const {host} = await mountFixture("pending");
        const subject = host.querySelector("[data-lab-subject]");
        expect(subject).not.toBeNull();
        expect(host.textContent).toContain("是否确认将反派角色‘罗恩’的背叛动机");
        expect(host.textContent).toContain("等待用户回答");
        // 纯只读卡片，选项不可作为 button 点击
        const buttons = host.querySelectorAll("[data-lab-subject] [role='button']");
        expect(buttons.length).toBe(0);
    });

    it("挂载 answered-choice 场景，只读高亮已选中的选项并展示已选择徽章", async () => {
        const {host} = await mountFixture("answered-choice");
        expect(host.textContent).toContain("确认修改（增加家族契约悲剧色彩）");
        expect(host.textContent).toContain("已选择");
        expect(host.textContent).toContain("展开");
    });

    it("挂载 answered-open 场景，展示无选项的开放式提问题干与作者文本答复", async () => {
        const {host} = await mountFixture("answered-open");
        expect(host.textContent).toContain("设定讨论");
        expect(host.textContent).toContain("请详细描述第三卷登场的古神祭坛的建筑风格与周边生态环境。");
        expect(host.textContent).toContain("祭坛由黑曜石与风化玄武岩筑成");
        expect(host.textContent).not.toContain("未选");
    });

    it("挂载 answered-custom 场景，展示已决选项与补充说明", async () => {
        const {host} = await mountFixture("answered-custom");
        expect(host.textContent).toContain("确认修改（增加家族契约悲剧色彩）");
        expect(host.textContent).toContain("建议将家族契约与第三卷的古神祭坛暗中关联起来");
    });

    it("挂载 tool-approval 场景，展示审批卡片与已批准决定", async () => {
        const {host} = await mountFixture("tool-approval");
        expect(host.textContent).toContain("审批");
        expect(host.textContent).toContain("Agent 请求执行文件更新");
        expect(host.textContent).toContain("批准执行");
        expect(host.textContent).toContain("已通过大纲审查，允许更新");
    });

    it("挂载 multi-questions 场景，完整展示多个组合问题及其专属已决选项", async () => {
        const {host} = await mountFixture("multi-questions");
        expect(host.textContent).toContain("情节走向决策");
        expect(host.textContent).toContain("章节篇幅规划");
        expect(host.textContent).toContain("已回答 2 / 2");
    });

    it("挂载 streaming 场景，宽容呈现流式中的参数文本", async () => {
        const {host} = await mountFixture("streaming");
        expect(host.textContent).toContain("是否确认调整角色动机");
    });

    it("支持通过 props.toolCall 编辑题目与作答，并在组件中即时响应渲染", async () => {
        const {host, input} = await mountFixture("answered-choice");
        const call = input.value.props!.toolCall as AgentToolCall;
        const args = JSON.parse(call.argsText) as {questions: Array<{header: string; question: string; options: Array<{label: string; description?: string}>}>};
        args.questions[0] = {
            header: "动态注入测试",
            question: "是否在第十章引爆地下矿脉的魔法水晶？",
            options: [
                {label: "立即引爆造成全面坍塌", description: "不可逆的剧情重大变故"},
                {label: "拆除引线保留矿脉设施", description: "稳妥的探索路线"},
            ],
        };
        const argsJson = JSON.stringify(args);
        input.value = {...input.value, props: {toolCall: {
            ...call, argsText: argsJson, argsJson,
            resultData: {answers: [{questionIndex: 0, selectedOptionIndex: 0, note: "作者特别批注：坍塌后主角将跌入深渊古遗迹"}]},
        }}};
        await vue.nextTick();
        expect(host.textContent).toContain("动态注入测试");
        expect(host.textContent).toContain("是否在第十章引爆地下矿脉的魔法水晶？");
        expect(host.textContent).toContain("立即引爆造成全面坍塌");
        expect(host.textContent).toContain("作者特别批注：坍塌后主角将跌入深渊古遗迹");
    });
});
