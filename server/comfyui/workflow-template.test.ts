import {describe, expect, it} from "vitest";
import {
    BUILTIN_TXT2IMG_MAPPING,
    BUILTIN_TXT2IMG_TEMPLATE,
    buildBuiltinWorkflow,
    buildWorkflow,
    ComfyUiWorkflowMappingError,
    detectInjectionPoints,
    type ComfyUiInjectionParams,
} from "nbook/server/comfyui/workflow-template";

const PARAMS: ComfyUiInjectionParams = {
    positive: "1girl, snow",
    negative: "lowres",
    width: 1024,
    height: 1536,
    steps: 28,
    cfg: 5,
    seed: 12345,
};

type AnyNode = {class_type?: string; inputs?: Record<string, unknown>};

describe("comfyui workflow template", () => {
    it("内置模板注入七参数 + checkpoint，且不改原模板", () => {
        const workflow = buildBuiltinWorkflow(PARAMS, "anima.safetensors") as Record<string, AnyNode>;
        expect(workflow["6"]!.inputs!.text).toBe("1girl, snow");
        expect(workflow["7"]!.inputs!.text).toBe("lowres");
        expect(workflow["5"]!.inputs!.width).toBe(1024);
        expect(workflow["5"]!.inputs!.height).toBe(1536);
        expect(workflow["3"]!.inputs!.seed).toBe(12345);
        expect(workflow["3"]!.inputs!.steps).toBe(28);
        expect(workflow["3"]!.inputs!.cfg).toBe(5);
        expect(workflow["4"]!.inputs!.ckpt_name).toBe("anima.safetensors");
        // 原模板保持空值（深拷贝隔离）
        expect((BUILTIN_TXT2IMG_TEMPLATE["6"] as AnyNode).inputs!.text).toBe("");
    });

    it("内置模板缺 checkpoint 拒绝", () => {
        expect(() => buildBuiltinWorkflow(PARAMS, "  ")).toThrow(ComfyUiWorkflowMappingError);
    });

    it("mapping 指向不存在的节点抛错；null 项跳过注入", () => {
        expect(() => buildWorkflow(BUILTIN_TXT2IMG_TEMPLATE as Record<string, unknown>, {
            ...BUILTIN_TXT2IMG_MAPPING,
            positive: {nodeId: "99", field: "text"},
        }, PARAMS)).toThrow(ComfyUiWorkflowMappingError);

        const workflow = buildWorkflow(BUILTIN_TXT2IMG_TEMPLATE as Record<string, unknown>, {
            ...BUILTIN_TXT2IMG_MAPPING,
            cfg: null,
        }, PARAMS) as Record<string, AnyNode>;
        // cfg 不注入时保留模板自带值
        expect(workflow["3"]!.inputs!.cfg).toBe(4.5);
    });

    it("自动识别标准 txt2img 工作流的全部注入点", () => {
        const {mapping, issues} = detectInjectionPoints(BUILTIN_TXT2IMG_TEMPLATE as Record<string, unknown>);
        expect(mapping).toEqual(BUILTIN_TXT2IMG_MAPPING);
        expect(issues).toEqual([]);
    });

    it("识别 noise_seed 与自定义采样器（good-anima 风格）", () => {
        // 模拟非标准节点：无 KSampler class_type，但 inputs 有 noise_seed/steps/cfg 与提示词连线
        const workflow: Record<string, AnyNode> = {
            "11": {class_type: "CLIPTextEncode", inputs: {text: "positive here", clip: ["2", 1]}},
            "12": {class_type: "CLIPTextEncode", inputs: {text: "negative here", clip: ["2", 1]}},
            "20": {class_type: "FLS_SamplerV4", inputs: {noise_seed: 1, steps: 30, cfg: 4, positive: ["11", 0], negative: ["12", 0], latent_image: ["30", 0]}},
            "30": {class_type: "EmptyLatentImage", inputs: {width: 832, height: 1216, batch_size: 1}},
        };
        const {mapping, issues} = detectInjectionPoints(workflow as Record<string, unknown>);
        expect(mapping.seed).toEqual({nodeId: "20", field: "noise_seed"});
        expect(mapping.positive).toEqual({nodeId: "11", field: "text"});
        expect(mapping.negative).toEqual({nodeId: "12", field: "text"});
        expect(mapping.width).toEqual({nodeId: "30", field: "width"});
        expect(issues).toEqual([]);
    });

    it("conditioning 透传节点：沿连线向上追到含 text 的节点", () => {
        const workflow: Record<string, AnyNode> = {
            "1": {class_type: "CLIPTextEncode", inputs: {text: "real positive", clip: ["9", 1]}},
            "2": {class_type: "ConditioningSetArea", inputs: {conditioning: ["1", 0], width: 64}},
            "3": {class_type: "KSampler", inputs: {seed: 0, steps: 20, cfg: 7, positive: ["2", 0], negative: ["4", 0]}},
            "4": {class_type: "CLIPTextEncode", inputs: {text: "neg", clip: ["9", 1]}},
        };
        const {mapping} = detectInjectionPoints(workflow as Record<string, unknown>);
        expect(mapping.positive).toEqual({nodeId: "1", field: "text"});
    });

    it("识别不全时输出 issues 且缺失项为 null", () => {
        const {mapping, issues} = detectInjectionPoints({
            "1": {class_type: "LoadImage", inputs: {image: "a.png"}},
        });
        expect(mapping.positive).toBeNull();
        expect(mapping.seed).toBeNull();
        expect(issues.length).toBeGreaterThan(0);
    });
});
