// @vitest-environment jsdom
import {mount} from "@vue/test-utils";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {Slider} from "@notnotype/nb-ui/components";
import ModelPickerContent from "./ModelPickerContent.vue";
import ModelPickerPopover from "./ModelPickerPopover.vue";
import type {ModelPickerModelItem, ModelPickerRoleItem} from "./model-picker.types";

const mockRoles: ModelPickerRoleItem[] = [
    {
        id: "tiny",
        axis: "gradient",
        name: "极轻量",
        description: "会话标题、简单分类",
        modelKey: "openai/gpt-4o-mini",
        modelLabel: "GPT-4o Mini",
        iconClass: "i-lucide-feather",
        enabled: true,
    },
    {
        id: "fast",
        axis: "gradient",
        name: "快速",
        description: "日常问答、搜索",
        modelKey: "deepseek/deepseek-chat",
        modelLabel: "DeepSeek V3",
        iconClass: "i-lucide-zap",
        enabled: true,
    },
    {
        id: "main",
        axis: "gradient",
        name: "主力",
        description: "综合分析、长文写作",
        modelKey: "anthropic/claude-3-7-sonnet",
        modelLabel: "Claude 3.7 Sonnet",
        iconClass: "i-lucide-star",
        enabled: true,
    },
    {
        id: "deep",
        axis: "gradient",
        name: "深度",
        description: "复杂推理与架构",
        modelKey: "deepseek/deepseek-reasoner",
        modelLabel: "DeepSeek R1",
        iconClass: "i-lucide-brain",
        enabled: true,
    },
    {
        id: "writer",
        axis: "specialist",
        name: "创作",
        description: "创意写作与小说正文",
        modelKey: "anthropic/claude-3-7-sonnet",
        modelLabel: "Claude 3.7 Sonnet",
        iconClass: "i-lucide-pen-line",
        enabled: true,
    },
    {
        id: "vision",
        axis: "specialist",
        name: "视觉",
        description: "图像与多模态解读",
        modelKey: "openai/gpt-4o",
        modelLabel: "GPT-4o Omnimodal",
        iconClass: "i-lucide-eye",
        enabled: true,
    },
];

const mockModels: ModelPickerModelItem[] = [
    {
        key: "anthropic/claude-3-7-sonnet",
        label: "Claude 3.7 Sonnet",
        providerId: "anthropic",
        providerName: "Anthropic",
        modelId: "claude-3-7-sonnet",
        contextWindowTokens: 200000,
        input: ["text", "image"],
        reasoning: true,
        cost: {input: 3, output: 15},
    },
    {
        key: "openai/gpt-4o",
        label: "GPT-4o Omnimodal",
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "gpt-4o",
        contextWindowTokens: 128000,
        input: ["text", "image"],
        reasoning: false,
        cost: {input: 2.5, output: 10},
    },
    {
        key: "deepseek/deepseek-reasoner",
        label: "DeepSeek R1 (Reasoning)",
        providerId: "deepseek",
        providerName: "DeepSeek",
        modelId: "deepseek-reasoner",
        contextWindowTokens: 64000,
        input: ["text"],
        reasoning: true,
        cost: {input: 0.55, output: 2.19},
    },
];

describe("ModelPickerContent", () => {
    beforeEach(() => {
        vi.stubGlobal("useI18n", () => ({t: (key: string) => key}));
        vi.stubGlobal("ResizeObserver", class {
            observe() {}
            unobserve() {}
            disconnect() {}
        });
    });

    it("默认展示 4 档梯度角色，在未开启时隐藏专精轴", () => {
        const wrapper = mount(ModelPickerContent, {
            props: {
                modelValue: "role:main",
                roles: mockRoles,
                models: mockModels,
                showSpecialistInPicker: false,
            },
        });

        // 梯度轴 4 档均应渲染
        expect(wrapper.text()).toContain("极轻量");
        expect(wrapper.text()).toContain("快速");
        expect(wrapper.text()).toContain("主力");
        expect(wrapper.text()).toContain("深度");

        // 专精轴不应展示
        expect(wrapper.text()).not.toContain("专精角色 (用户已开启展示)");
        expect(wrapper.text()).not.toContain("创意写作与小说正文");
    });

    it("开启 showSpecialistInPicker 后展示专精轴角色", () => {
        const wrapper = mount(ModelPickerContent, {
            props: {
                modelValue: "role:writer",
                roles: mockRoles,
                models: mockModels,
                showSpecialistInPicker: true,
            },
        });

        // 专精轴展示
        expect(wrapper.text()).toContain("专精角色 (用户已开启展示)");
        expect(wrapper.text()).toContain("创作");
        expect(wrapper.text()).toContain("视觉");
    });

    it("按 Provider 分组展示模型库并展示能力徽章与上下文", async () => {
        const wrapper = mount(ModelPickerContent, {
            props: {
                modelValue: "anthropic/claude-3-7-sonnet",
                roles: mockRoles,
                models: mockModels,
            },
        });

        // 点击切换到“模型库” Tab
        const modelsTabButton = wrapper.findAll("button").find((btn) => btn.text() === "模型库");
        expect(modelsTabButton).toBeDefined();
        await modelsTabButton!.trigger("click");

        // 分组标题
        expect(wrapper.text()).toContain("Anthropic");
        expect(wrapper.text()).toContain("OpenAI");
        expect(wrapper.text()).toContain("DeepSeek");

        // 模型名称与能力
        expect(wrapper.text()).toContain("Claude 3.7 Sonnet");
        expect(wrapper.text()).toContain("200k ctx");
        expect(wrapper.text()).toContain("Reasoning");
        expect(wrapper.text()).toContain("Vision");
        expect(wrapper.text()).toContain("$3 / $15");
    });

    it("点击角色卡片发出 role:id 格式的值与 select 事件", async () => {
        const wrapper = mount(ModelPickerContent, {
            props: {
                modelValue: "role:main",
                roles: mockRoles,
                models: mockModels,
            },
        });

        const roleButtons = wrapper.findAll("button");
        const fastRoleButton = roleButtons.find((btn) => btn.text().includes("快速"));
        expect(fastRoleButton).toBeDefined();

        await fastRoleButton!.trigger("click");

        expect(wrapper.emitted("update:modelValue")).toBeTruthy();
        expect(wrapper.emitted("update:modelValue")![0]).toEqual(["role:fast"]);
        expect(wrapper.emitted("select")).toBeTruthy();
        expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("点击具体模型发出 model.key 与 select 事件", async () => {
        const wrapper = mount(ModelPickerContent, {
            props: {
                modelValue: "role:main",
                roles: mockRoles,
                models: mockModels,
            },
        });

        // 点击切换到“模型库” Tab
        const modelsTabButton = wrapper.findAll("button").find((btn) => btn.text() === "模型库");
        expect(modelsTabButton).toBeDefined();
        await modelsTabButton!.trigger("click");

        const modelButtons = wrapper.findAll("button");
        const gpt4oButton = modelButtons.find((btn) => btn.text().includes("GPT-4o Omnimodal"));
        expect(gpt4oButton).toBeDefined();

        await gpt4oButton!.trigger("click");

        expect(wrapper.emitted("update:modelValue")).toBeTruthy();
        expect(wrapper.emitted("update:modelValue")![0]).toEqual(["openai/gpt-4o"]);
        expect(wrapper.emitted("select")).toBeTruthy();
        expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("支持关键词在模型库即时过滤，且角色 Tab 不展示搜索框", async () => {
        const wrapper = mount(ModelPickerContent, {
            props: {
                modelValue: "role:main",
                roles: mockRoles,
                models: mockModels,
                showSpecialistInPicker: true,
            },
        });

        // 角色 Tab 默认不展示搜索框
        expect(wrapper.find("input[type='text']").exists()).toBe(false);

        // 切换到模型库 Tab
        const modelsTab = wrapper.findAll("button").find((btn) => btn.text() === "模型库");
        expect(modelsTab).toBeDefined();
        await modelsTab!.trigger("click");

        // 模型库 Tab 出现搜索框并可过滤
        const searchInput = wrapper.find("input[type='text']");
        expect(searchInput.exists()).toBe(true);
        await searchInput.setValue("claude");

        expect(wrapper.text()).toContain("Claude 3.7 Sonnet");
        expect(wrapper.text()).not.toContain("DeepSeek R1 (Reasoning)");
    });

    it("内置思考等级滑块调节发出 update:thinkingLevel 事件", async () => {
        const wrapper = mount(ModelPickerContent, {
            props: {
                modelValue: "role:main",
                roles: mockRoles,
                models: mockModels,
                thinkingLevel: "medium",
            },
        });

        expect(wrapper.text()).toContain("思考等级");
        expect(wrapper.text()).toContain("[中等强度]");

        // 调节滑块到 5 (high 档位)
        const slider = wrapper.findComponent(Slider);
        expect(slider.exists()).toBe(true);
        await slider.vm.$emit("update:modelValue", 5);

        expect(wrapper.emitted("update:thinkingLevel")).toBeTruthy();
        expect(wrapper.emitted("update:thinkingLevel")![0]).toEqual(["high"]);
    });
});

describe("ModelPickerPopover", () => {
    beforeEach(() => {
        vi.stubGlobal("useI18n", () => ({t: (key: string) => key}));
        vi.stubGlobal("ResizeObserver", class {
            observe() {}
            unobserve() {}
            disconnect() {}
        });
    });

    it("触发按钮正确呈现当前激活的角色名与绑定模型", () => {
        const wrapper = mount(ModelPickerPopover, {
            props: {
                open: false,
                modelValue: "role:main",
                roles: mockRoles,
                models: mockModels,
            },
        });

        expect(wrapper.find("button[role='combobox']").text()).toContain("主力");
        expect(wrapper.find("button[role='combobox']").text()).toContain("Claude 3.7 Sonnet");
    });

    it("点击触发按钮发出 update:open 事件", async () => {
        const wrapper = mount(ModelPickerPopover, {
            props: {
                open: false,
                modelValue: "role:main",
                roles: mockRoles,
                models: mockModels,
            },
        });

        await wrapper.find("button[role='combobox']").trigger("click");
        expect(wrapper.emitted("update:open")).toBeTruthy();
        expect(wrapper.emitted("update:open")![0]).toEqual([true]);
    });

    it("透传 thinkingLevel 并在内容变更时转发 update:thinkingLevel", async () => {
        const wrapper = mount(ModelPickerPopover, {
            props: {
                open: true,
                modelValue: "role:main",
                roles: mockRoles,
                models: mockModels,
                thinkingLevel: "low",
            },
        });

        // 调节滑块到 4 (medium 档位)
        const slider = wrapper.findComponent(Slider);
        expect(slider.exists()).toBe(true);
        await slider.vm.$emit("update:modelValue", 4);

        expect(wrapper.emitted("update:thinkingLevel")).toBeTruthy();
        expect(wrapper.emitted("update:thinkingLevel")![0]).toEqual(["medium"]);
    });
});
