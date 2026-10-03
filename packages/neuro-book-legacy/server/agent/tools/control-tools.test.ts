import {describe, expect, it} from "vitest";
import {Value} from "typebox/value";
import type {NeuroToolResult} from "nbook/server/agent/tools/types";
import {controlTools} from "nbook/server/agent/tools/control-tools";
import type {UserInputRequestContext, ToolExecutionContext, UserInputFormSpec} from "nbook/server/agent/tools/types";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";

describe("request_user_input userInputRequest", () => {
    const requestUserInputTool = controlTools.requestUserInput.runtime();

    it("等待用户输入但不生成 Low-Code formSpec", async () => {
        const result = await requestUserInputTool.userInputRequest!.when(requestContext({
            questions: [{question: "请输入您的名字", header: "用户信息"}],
        }));

        expect(result).toBe(true);
    });

    it("schema 接受问题、header 和单选 options", () => {
        expect(Value.Check(requestUserInputTool.parameters, {
            questions: [{
                header: "偏好",
                question: "选择您的偏好",
                options: [
                    {label: "选项 A", description: "这是 A"},
                    {label: "选项 B"},
                ],
            }],
        })).toBe(true);
    });

    it("schema 拒绝默认值、推荐和多选旧字段", () => {
        const invalidQuestions = [
            {question: "Pick", options: [{label: "A", recommended: true}]},
            {question: "Pick", options: [{label: "A", defaultSelected: true}]},
            {question: "Pick", options: [{label: "A"}], defaultOptionIndex: 0},
            {question: "Pick", options: [{label: "A"}], defaultOptionIndexes: [0]},
            {question: "Pick", options: [{label: "A"}], multiSelect: true},
        ];

        for (const question of invalidQuestions) {
            expect(Value.Check(requestUserInputTool.parameters, {
                questions: [question],
            })).toBe(false);
        }
    });

    it("executeWithContext 正确处理开放式问题的用户输入", async () => {
        const params = {
            questions: [
                {question: "您的名字？"},
                {question: "您的爱好？"},
            ],
        };

        const userInput = {
            answer_0: "张三",
            answer_1: "阅读",
        };

        const result = await requestUserInputTool.executeWithContext!(
            toolContext(),
            "call-1",
            params,
            userInput,
        );

        expect(result.terminate).toBe(true);
        expect(result.content).toHaveLength(1);
        const text = readText(result);
        expect(text).toContain("您的名字？");
        expect(text).toContain("回答：张三");
        expect(text).toContain("您的爱好？");
        expect(text).toContain("回答：阅读");

        expect(result.details).toEqual({
            answers: [
                {questionIndex: 0, text: "张三"},
                {questionIndex: 1, text: "阅读"},
            ],
        });
    });

    it("executeWithContext 正确处理单选问题的用户输入", async () => {
        const params = {
            questions: [
                {
                    question: "选择颜色",
                    options: [
                        {label: "红色"},
                        {label: "蓝色"},
                        {label: "绿色"},
                    ],
                },
            ],
        };

        const userInput = {
            answer_0: 1, // 选择 "蓝色"
        };

        const result = await requestUserInputTool.executeWithContext!(
            toolContext(),
            "call-1",
            params,
            userInput,
        );

        expect(result.details).toEqual({
            answers: [
                {
                    questionIndex: 0,
                    text: "蓝色",
                    selectedOptionIndex: 1,
                },
            ],
        });
    });

    it("executeWithContext 不会为未提交字段套默认选项", async () => {
        const params = {
            questions: [
                {
                    question: "第一章正文从哪里开始？",
                    options: [
                        {label: "从村口出发写起"},
                        {label: "从遇狼战斗写起"},
                        {label: "从抵达遗迹写起"},
                    ],
                },
                {
                    question: "第一章的核心冲突是什么？",
                    options: [
                        {label: "遗迹探索"},
                        {label: "遗迹中的秘密"},
                    ],
                },
            ],
        };

        const result = await requestUserInputTool.executeWithContext!(
            toolContext(),
            "call-1",
            params,
            {answer_1: 1},
        );

        expect(readText(result)).toContain("1. 第一章正文从哪里开始？\n回答：");
        expect(readText(result)).toContain("2. 第一章的核心冲突是什么？\n回答：遗迹中的秘密");
        expect(result.details).toEqual({
            answers: [
                {questionIndex: 0, text: ""},
                {questionIndex: 1, text: "遗迹中的秘密", selectedOptionIndex: 1},
            ],
        });
    });

    it("executeWithContext 正确处理 note-only answers", async () => {
        const params = {
            questions: [
                {
                    question: "选择颜色",
                    options: [
                        {label: "红色"},
                        {label: "蓝色"},
                        {label: "绿色"},
                    ],
                },
            ],
        };

        const result = await requestUserInputTool.executeWithContext!(
            toolContext(),
            "call-1",
            params,
            [{questionIndex: 0, note: "我想选黄色"}],
        );

        expect(readText(result)).toContain("选择颜色\n回答：我想选黄色");
        expect(result.details).toEqual({
            answers: [
                {
                    questionIndex: 0,
                    text: "我想选黄色",
                    note: "我想选黄色",
                },
            ],
        });
    });

    it("executeWithContext 混合问题类型的用户输入", async () => {
        const params = {
            questions: [
                {question: "您的名字？"},
                {
                    question: "性别？",
                    options: [{label: "男"}, {label: "女"}],
                },
                {question: "兴趣爱好？"},
            ],
        };

        const userInput = {
            answer_0: "李四",
            answer_1: 0,
            answer_2: "阅读和旅游",
        };

        const result = await requestUserInputTool.executeWithContext!(
            toolContext(),
            "call-1",
            params,
            userInput,
        );

        expect(result.details).toEqual({
            answers: [
                {questionIndex: 0, text: "李四"},
                {questionIndex: 1, text: "男", selectedOptionIndex: 0},
                {questionIndex: 2, text: "阅读和旅游"},
            ],
        });
    });

    it("executeWithContext 不再把数组旧值解释成多选答案", async () => {
        const params = {
            questions: [
                {
                    question: "选择标签",
                    options: [
                        {label: "剧情"},
                        {label: "人物"},
                        {label: "节奏"},
                    ],
                },
            ],
        };

        const result = await requestUserInputTool.executeWithContext!(
            toolContext(),
            "call-1",
            params,
            {answer_0: [0, 2]},
        );

        expect(readText(result)).toContain("选择标签\n回答：");
        expect(result.details).toEqual({
            answers: [
                {
                    questionIndex: 0,
                    text: "",
                },
            ],
        });
    });

    it("executeWithContext 没有 userInput 时抛出错误", async () => {
        const params = {
            questions: [{question: "测试问题"}],
        };

        await expect(
            requestUserInputTool.executeWithContext!(toolContext(), "call-1", params, undefined),
        ).rejects.toThrow("request_user_input 需要用户输入数据");
    });
});

describe("switch_mode userInputRequest", () => {
    const switchModeTool = controlTools.switchMode.runtime();

    it("工具描述为英文", () => {
        expect(switchModeTool.description).not.toMatch(/[一-鿿]/);
    });

    it("plan 目标生成 radio 审批字段", async () => {
        const formSpec = expectUserInputFormSpec(await switchModeTool.userInputRequest!.when(requestContext({
            targetMode: "plan",
            reason: "需要制定详细的实现计划",
        })));

        expect(formSpec.form.fields).toHaveLength(1);

        const field = formSpec.form.fields[0]!;
        expect(field.path).toBe("approved");
        expect(field.component).toBe("radio");
        expect(field.label).toBe("是否批准进入计划模式？");
        expect(field.description).toBe("需要制定详细的实现计划");
        expect(field.required).toBe(true);
        expect(field.options).toEqual([
            {value: true, label: "批准"},
            {value: false, label: "拒绝"},
        ]);
        expect(field.defaultValue).toBe(true);
    });

    it("discuss 目标使用讨论模式文案", async () => {
        const formSpec = expectUserInputFormSpec(await switchModeTool.userInputRequest!.when(requestContext({
            targetMode: "discuss",
        })));

        expect(formSpec.form.fields).toHaveLength(1);
        expect(formSpec.form.fields[0]!.label).toBe("是否批准进入讨论模式？");
        expect(formSpec.prompt).toBe("进入讨论模式");
    });

    it("normal 目标带 planFilePath 时添加计划文件预览字段", async () => {
        const formSpec = expectUserInputFormSpec(await switchModeTool.userInputRequest!.when(requestContext({
            targetMode: "normal",
            reason: "计划已完成",
            planFilePath: ".agent/plan/feature-x.md",
        })));

        expect(formSpec.form.fields).toHaveLength(2);

        const approvalField = formSpec.form.fields[0]!;
        expect(approvalField.path).toBe("approved");
        expect(approvalField.component).toBe("radio");
        expect(approvalField.label).toBe("是否批准切换到普通模式（开始执行）？");

        const previewField = formSpec.form.fields[1]!;
        expect(previewField.path).toBe("planPreviewNote");
        expect(previewField.component).toBe("text");
        expect(previewField.label).toBe("计划文件");
        expect(previewField.description).toContain(".agent/plan/feature-x.md");
        expect(previewField.defaultValue).toBe(".agent/plan/feature-x.md");
        expect(previewField.required).toBe(false);
    });

    it("非 normal 目标忽略 planFilePath 预览字段", async () => {
        const formSpec = expectUserInputFormSpec(await switchModeTool.userInputRequest!.when(requestContext({
            targetMode: "plan",
            planFilePath: ".agent/plan/feature-x.md",
        })));

        expect(formSpec.form.fields).toHaveLength(1);
        expect(formSpec.form.fields[0]!.path).toBe("approved");
    });

    it("批准后返回 pending 与 targetMode", async () => {
        const result = await switchModeTool.executeWithContext!(
            createToolContext(),
            "call-1",
            {targetMode: "normal", reason: "计划完成", planFilePath: ".agent/plan/test.md"},
            {approved: true},
        );

        expect(result.terminate).toBe(true);
        expect(result.details).toEqual({approved: true, pending: true, targetMode: "normal"});
        expect(readText(result)).toContain("请求切换到普通模式：计划完成");
    });

    it("拒绝后终止并返回拒绝状态", async () => {
        const result = await switchModeTool.executeWithContext!(
            createToolContext(),
            "call-1",
            {targetMode: "plan", reason: "制定计划"},
            {approved: false},
        );

        expect(result.terminate).toBe(true);
        expect(result.details).toEqual({approved: false, targetMode: "plan"});
        expect(readText(result)).toBe("用户拒绝切换到计划模式。");
    });
});

describe("协议边界", () => {
    it("request_user_input schema 不兼容默认值和多选旧字段", () => {
        const tool = controlTools.requestUserInput.runtime();

        expect(Value.Check(tool.parameters, {
            questions: [
                {
                    question: "选择",
                    options: [{label: "A"}],
                    defaultOptionIndex: 0,
                },
            ],
        })).toBe(false);

        expect(Value.Check(tool.parameters, {
            questions: [
                {
                    question: "选择",
                    options: [
                        {label: "A", defaultSelected: true},
                        {label: "B"},
                    ],
                },
            ],
        })).toBe(false);

        expect(Value.Check(tool.parameters, {
            questions: [
                {
                    question: "多选",
                    options: [{label: "A"}, {label: "B"}],
                    multiSelect: true,
                    defaultOptionIndexes: [0, 1],
                },
            ],
        })).toBe(false);
    });

    it("switch_mode schema 要求合法 targetMode", () => {
        const tool = controlTools.switchMode.runtime();

        // targetMode 必填且只接受三个合法值
        expect(Value.Check(tool.parameters, {})).toBe(false);
        expect(Value.Check(tool.parameters, {targetMode: "unknown"})).toBe(false);
        expect(Value.Check(tool.parameters, {targetMode: "normal"})).toBe(true);
        expect(Value.Check(tool.parameters, {targetMode: "discuss", reason: "test"})).toBe(true);
        expect(Value.Check(tool.parameters, {targetMode: "plan", reason: "test"})).toBe(true);

        // 退出计划模式可携带 planFilePath
        expect(Value.Check(tool.parameters, {
            targetMode: "normal",
            reason: "done",
            planFilePath: ".agent/plan/test.md",
        })).toBe(true);
    });
});

function readText(result: NeuroToolResult): string {
    const item = result.content[0];
    if (!item || item.type !== "text") {
        throw new Error("测试期望工具返回 text content");
    }
    return item.text;
}

function requestContext(args: unknown): UserInputRequestContext {
    return {
        args,
        session: {
            sessionId: 1,
            profileKey: "test-profile",
            workspaceRoot: absoluteFsPath("/test/workspace"),
            currentProject: null,
        },
    };
}

function toolContext(): ToolExecutionContext {
    return createToolContext();
}

function expectUserInputFormSpec(value: UserInputFormSpec | true | null): UserInputFormSpec & {form: NonNullable<UserInputFormSpec["form"]>} {
    if (!value || value === true || !value.form) {
        throw new Error("测试期望工具生成 Low-Code formSpec");
    }
    return value as UserInputFormSpec & {form: NonNullable<UserInputFormSpec["form"]>};
}

function createToolContext(): ToolExecutionContext {
    return {
        harness: {} as ToolExecutionContext["harness"],
        sessionId: 1,
        profileKey: "test-profile",
        workspaceRoot: absoluteFsPath(process.cwd()),
        currentProject: null,
    };
}
