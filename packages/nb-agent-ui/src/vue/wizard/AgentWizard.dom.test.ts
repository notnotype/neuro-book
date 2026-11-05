import {mount} from "@vue/test-utils";
import {nextTick} from "vue";
import {describe, expect, it} from "vitest";

import type {PendingApprovalView, PendingInputView} from "../../types";
import AgentWizard from "./AgentWizard.vue";

const approval = (id: string, tool = "edit"): PendingApprovalView => ({kind: "approval", id, toolCallId: `c-${id}`, tool, args: {path: `project://${id}.md`}, preview: {state: "ready", files: [{address: `project://${id}.md`, kind: "diff", before: "旧", after: "新"}]}});
const question: PendingInputView = {
    kind: "question",
    id: "q",
    toolCallId: "c-q",
    questions: [
        {question: "视角？", options: [{label: "第一人称"}, {label: "第三人称"}]},
        {question: "人物？", multiSelect: true, options: [{label: "甲"}, {label: "乙"}]},
    ],
};

function wizard(pending: readonly PendingInputView[], state?: never) {
    return mount(AgentWizard, {props: {pending, state}, attachTo: document.body});
}
const actions = (view: ReturnType<typeof wizard>) => (view.emitted("action") ?? []).map(([action]) => action as {type: string; batchKey?: string; resolutions?: unknown});
const submitted = (view: ReturnType<typeof wizard>) => actions(view).filter((action) => action.type === "input.submit");

describe("审批向导", () => {
    it("只有一个时，批准就是提交", async () => {
        const view = wizard([approval("a")]);
        expect(view.find("[data-wizard-count]").exists()).toBe(false);
        await view.get("[data-approval-decision='allow']").trigger("click");
        expect(submitted(view)).toEqual([{type: "input.submit", batchKey: "a", resolutions: {kind: "approval", decision: "allow"}}]);
        view.unmount();
    });

    it("一批：一步一个，都选了才能提交；能来回改；提交时一个事项一条", async () => {
        const view = wizard([approval("a"), approval("b", "shell"), approval("c")]);
        expect(view.get("[data-wizard-count]").text()).toBe("第 1 / 3 个");
        const submit = view.get("[data-approval-submit]");
        expect(submit.attributes("disabled")).toBeDefined();
        await view.get("[data-approval-decision='allow']").trigger("click");
        expect(view.get("[data-wizard-count]").text()).toBe("第 2 / 3 个");
        await view.get("[data-approval-decision='deny']").trigger("click");
        expect(view.get("[data-wizard-count]").text()).toBe("第 3 / 3 个");
        expect(submitted(view)).toEqual([]);
        await view.get("[data-approval-decision='allow']").trigger("click");
        expect(view.get("[data-approval-submit]").attributes("disabled")).toBeUndefined();
        // 回到第一个改成拒绝。
        await view.get("[data-approval-step='previous']").trigger("click");
        await view.get("[data-approval-step='previous']").trigger("click");
        expect(view.get("[data-wizard-count]").text()).toBe("第 1 / 3 个");
        await view.get("[data-approval-decision='deny']").trigger("click");
        await view.get("[data-approval-submit]").trigger("click");
        expect(submitted(view).map((action) => [action.batchKey, (action.resolutions as {decision: string}).decision])).toEqual([["a", "deny"], ["b", "deny"], ["c", "allow"]]);
        view.unmount();
    });

    it("本会话都批准同时选中这批里同一个工具的其余调用", async () => {
        const view = wizard([approval("a"), approval("b", "shell"), approval("c")]);
        await view.get("[data-approval-decision='allow-session']").trigger("click");
        // 第三个已经选了，下一个没选的是第二个。
        expect(view.get("[data-wizard-count]").text()).toBe("第 2 / 3 个");
        await view.get("[data-approval-decision='allow']").trigger("click");
        await view.get("[data-approval-submit]").trigger("click");
        expect(submitted(view).map((action) => [action.batchKey, (action.resolutions as {decision: string}).decision])).toEqual([["a", "allow-session"], ["b", "allow"], ["c", "allow-session"]]);
        view.unmount();
    });

    it("附言写了字：批准不可点，拒绝把这段话带上；全部拒绝带一段附言", async () => {
        const view = wizard([approval("a"), approval("b")]);
        await view.get("[data-approval-note] textarea, textarea[data-approval-note]").setValue("这段不要改");
        expect(view.get("[data-approval-decision='allow']").attributes("disabled")).toBeDefined();
        expect(view.get("[data-approval-decision='allow-session']").attributes("disabled")).toBeDefined();
        await view.get("[data-approval-deny-all]").trigger("click");
        expect(submitted(view).map((action) => action.resolutions)).toEqual([
            {kind: "approval", decision: "deny", note: "这段不要改"},
            {kind: "approval", decision: "deny", note: "这段不要改"},
        ]);
        view.unmount();
    });

    it("命令显示命令；别的工具列参数；预览查询失败写明并列参数", () => {
        const shell = wizard([{...approval("s", "shell"), args: {command: "rm -rf 正文", cwd: "project://", timeout: 30}, preview: {state: "ready", files: []}}]);
        expect(shell.get("[data-approval-command]").text()).toBe("rm -rf 正文");
        expect(shell.text()).toContain("project://");
        shell.unmount();
        const failed = wizard([{...approval("f", "write"), args: {path: "project://a.md", content: "全文"}, preview: {state: "failed"}}]);
        expect(failed.text()).toContain("预览不可用");
        expect(failed.text()).toContain("全文");
        failed.unmount();
    });

    it("多文件按文件分节：过大、算不出来的写明原因，也列出参数", () => {
        const view = wizard([{...approval("m"), args: {input: "补丁正文"}, preview: {state: "ready", files: [{address: "project://a.md", kind: "diff", before: "旧", after: "新"}, {address: "project://大.md", kind: "too-large", bytes: 999}, {address: "project://b.md", kind: "failed", code: "edit-stale"}]}}]);
        expect(view.findAll("[data-preview-file]").map((node) => node.attributes("data-preview-file"))).toEqual(["diff", "too-large", "failed"]);
        expect(view.text()).toContain("文件过大");
        expect(view.text()).toContain("无法预览");
        expect(view.text()).toContain("补丁正文");
        view.unmount();
    });
});

describe("提问向导", () => {
    it("全部答完才能提交；能回到上一题；提交带逐题的回答与人话", async () => {
        const view = wizard([question]);
        expect(view.get("[data-wizard-count]").text()).toBe("第 1 / 2 题");
        await view.get("[data-question-other] input, input[data-question-other]").setValue("第二人称");
        await view.get("[data-question-step='next']").trigger("click");
        expect(view.get("[data-question-submit]").attributes("disabled")).toBeDefined();
        await view.findAll("[role='checkbox'], input[type='checkbox']")[1]!.trigger("click");
        await nextTick();
        const submit = view.get("[data-question-submit]");
        expect(submit.attributes("disabled")).toBeUndefined();
        await view.get("[data-question-step='previous']").trigger("click");
        expect((view.get("[data-question-other] input, input[data-question-other]").element as HTMLInputElement).value).toBe("第二人称");
        await view.get("[data-question-step='next']").trigger("click");
        await view.get("[data-question-submit]").trigger("click");
        expect(submitted(view)).toEqual([{type: "input.submit", batchKey: "q", resolutions: {kind: "question", answer: {text: "视角？ 其他：第二人称\n人物？ 乙", data: {answers: [{selected: [], other: "第二人称"}, {selected: ["乙"]}]}}}}]);
        view.unmount();
    });

    it("停止这一轮走 input.cancelRun", async () => {
        const view = wizard([question]);
        await view.get("[data-question-stop]").trigger("click");
        expect(actions(view).map((action) => action.type)).toContain("input.cancelRun");
        view.unmount();
    });
});

describe("收起与焦点", () => {
    it("出现时焦点到容器，不到批准按钮", () => {
        const view = wizard([approval("a")]);
        expect(document.activeElement).toBe(view.get("[data-agent-wizard]").element);
        view.unmount();
    });

    it("Esc 只收起：没有批准按钮，焦点到展开按钮；再展开选的还在", async () => {
        const view = wizard([approval("a"), approval("b")]);
        await view.get("[data-approval-decision='allow']").trigger("click");
        await view.get("[data-agent-wizard]").trigger("keydown", {key: "Escape"});
        await nextTick();
        expect(view.find("[data-wizard-collapsed]").exists()).toBe(true);
        expect(view.find("[data-approval-decision='allow']").exists()).toBe(false);
        expect(submitted(view)).toEqual([]);
        expect(document.activeElement).toBe(view.get("[data-wizard-expand]").element);
        await view.get("[data-wizard-expand]").trigger("click");
        await nextTick();
        expect(view.find("[data-wizard-collapsed]").exists()).toBe(false);
        expect(view.get("[data-wizard-count]").text()).toBe("第 2 / 2 个");
        view.unmount();
    });

    it("状态交给宿主，重新挂载时读回来：切走标签再回来答案还在", async () => {
        const first = wizard([approval("a"), approval("b")]);
        await first.get("[data-approval-decision='allow']").trigger("click");
        const state = [...actions(first)].reverse().find((action) => action.type === "wizard.state") as unknown as {state: never};
        first.unmount();
        const second = wizard([approval("a"), approval("b")], state.state);
        expect(second.get("[data-wizard-count]").text()).toBe("第 2 / 2 个");
        second.unmount();
    });

    it("别的窗口先答了：跟着消失；这一批没了状态清空；来了新的一批从头来", async () => {
        const view = wizard([approval("a"), approval("b")]);
        await view.get("[data-approval-decision='allow']").trigger("click");
        await view.setProps({pending: [approval("b")]});
        expect(view.find("[data-wizard-count]").exists()).toBe(false);
        await view.setProps({pending: [approval("x"), approval("y")]});
        await nextTick();
        expect(view.get("[data-wizard-count]").text()).toBe("第 1 / 2 个");
        expect(view.get("[data-approval-submit]").attributes("disabled")).toBeDefined();
        view.unmount();
    });
});
