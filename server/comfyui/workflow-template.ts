import type {ComfyUiNodeFieldRefDto, ComfyUiWorkflowMappingDto} from "nbook/shared/dto/comfyui.dto";

/**
 * ComfyUI 工作流模板与参数注入。
 *
 * 工作流一律使用 ComfyUI「导出 API」的 JSON 形态：顶层 key 为节点 id，
 * 值为 {class_type, inputs}。注入即 workflow[nodeId].inputs[field] = value。
 */

/** API JSON 中的单个节点（只描述我们关心的字段）。 */
type ComfyUiWorkflowNode = {
    class_type?: string;
    inputs?: Record<string, unknown>;
    _meta?: {title?: string};
};

/** 注入参数集合；与 ComfyUiCreateJobRequestDto 对齐（seed 已解析为具体值）。 */
export type ComfyUiInjectionParams = {
    positive: string;
    negative: string;
    width: number;
    height: number;
    steps: number;
    cfg: number;
    seed: number;
};

export const BUILTIN_WORKFLOW_ID = "builtin/txt2img";

/**
 * 内置通用 txt2img 工作流：CheckpointLoaderSimple + 双 CLIPTextEncode + EmptyLatentImage
 * + KSampler + VAEDecode + SaveImage。兼容绝大多数 SD 系 checkpoint。
 * checkpoint 名称在构建时注入（config.comfyui.defaults.checkpoint）。
 */
export const BUILTIN_TXT2IMG_TEMPLATE: Record<string, ComfyUiWorkflowNode> = {
    "3": {
        class_type: "KSampler",
        _meta: {title: "KSampler"},
        inputs: {
            seed: 0,
            steps: 32,
            cfg: 4.5,
            sampler_name: "euler_ancestral",
            scheduler: "normal",
            denoise: 1,
            model: ["4", 0],
            positive: ["6", 0],
            negative: ["7", 0],
            latent_image: ["5", 0],
        },
    },
    "4": {
        class_type: "CheckpointLoaderSimple",
        _meta: {title: "Load Checkpoint"},
        inputs: {ckpt_name: ""},
    },
    "5": {
        class_type: "EmptyLatentImage",
        _meta: {title: "Empty Latent Image"},
        inputs: {width: 832, height: 1216, batch_size: 1},
    },
    "6": {
        class_type: "CLIPTextEncode",
        _meta: {title: "Positive Prompt"},
        inputs: {text: "", clip: ["4", 1]},
    },
    "7": {
        class_type: "CLIPTextEncode",
        _meta: {title: "Negative Prompt"},
        inputs: {text: "", clip: ["4", 1]},
    },
    "8": {
        class_type: "VAEDecode",
        _meta: {title: "VAE Decode"},
        inputs: {samples: ["3", 0], vae: ["4", 2]},
    },
    "9": {
        class_type: "SaveImage",
        _meta: {title: "Save Image"},
        inputs: {images: ["8", 0], filename_prefix: "nbook"},
    },
};

/** 内置模板的注入点 mapping（与上面的节点 id 对应）。 */
export const BUILTIN_TXT2IMG_MAPPING: ComfyUiWorkflowMappingDto = {
    positive: {nodeId: "6", field: "text"},
    negative: {nodeId: "7", field: "text"},
    width: {nodeId: "5", field: "width"},
    height: {nodeId: "5", field: "height"},
    seed: {nodeId: "3", field: "seed"},
    steps: {nodeId: "3", field: "steps"},
    cfg: {nodeId: "3", field: "cfg"},
};

/** mapping 指向不存在的节点/字段时抛出（400 语义，由 route 层转 HTTP）。 */
export class ComfyUiWorkflowMappingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ComfyUiWorkflowMappingError";
    }
}

/**
 * 深拷贝工作流并按 mapping 注入参数。mapping 项为 null 的参数跳过（用工作流自带值）。
 * 注入目标节点或 inputs 不存在时抛 ComfyUiWorkflowMappingError。
 */
export function buildWorkflow(
    template: Record<string, unknown>,
    mapping: ComfyUiWorkflowMappingDto,
    params: ComfyUiInjectionParams,
): Record<string, unknown> {
    const workflow = structuredClone(template) as Record<string, ComfyUiWorkflowNode>;
    const inject = (ref: ComfyUiNodeFieldRefDto | null, label: string, value: string | number): void => {
        if (!ref) {
            return;
        }
        const node = workflow[ref.nodeId];
        if (!node || typeof node !== "object") {
            throw new ComfyUiWorkflowMappingError(`注入点 ${label} 指向的节点 ${ref.nodeId} 不存在`);
        }
        if (!node.inputs || typeof node.inputs !== "object") {
            throw new ComfyUiWorkflowMappingError(`注入点 ${label} 的节点 ${ref.nodeId} 没有 inputs`);
        }
        node.inputs[ref.field] = value;
    };
    inject(mapping.positive, "positive", params.positive);
    inject(mapping.negative, "negative", params.negative);
    inject(mapping.width, "width", params.width);
    inject(mapping.height, "height", params.height);
    inject(mapping.seed, "seed", params.seed);
    inject(mapping.steps, "steps", params.steps);
    inject(mapping.cfg, "cfg", params.cfg);
    return workflow as Record<string, unknown>;
}

/**
 * 构建内置 txt2img 工作流：注入七参数 + checkpoint 名称。
 */
export function buildBuiltinWorkflow(params: ComfyUiInjectionParams, checkpoint: string): Record<string, unknown> {
    if (!checkpoint.trim()) {
        throw new ComfyUiWorkflowMappingError("内置工作流需要在设置中填写 checkpoint 模型文件名，或改用导入的自定义工作流");
    }
    const workflow = buildWorkflow(BUILTIN_TXT2IMG_TEMPLATE as Record<string, unknown>, BUILTIN_TXT2IMG_MAPPING, params) as Record<string, ComfyUiWorkflowNode>;
    workflow["4"]!.inputs!.ckpt_name = checkpoint.trim();
    return workflow as Record<string, unknown>;
}

/** 判断 inputs 里的值是否是节点连线（["nodeId", outputIndex] 形态）。 */
function isNodeLink(value: unknown): value is [string, number] {
    return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number";
}

function asNode(value: unknown): ComfyUiWorkflowNode | null {
    return value && typeof value === "object" && !Array.isArray(value) ? value as ComfyUiWorkflowNode : null;
}

/**
 * 自动识别注入点：
 * - 采样器节点：class_type 含 "KSampler"，或 inputs 同时含 seed/noise_seed 与 steps；取 seed/steps/cfg
 * - 正/负提示词：顺采样器 inputs.positive / inputs.negative 连线找到含字符串 text 字段的节点（CLIPTextEncode 系）
 * - 尺寸：EmptyLatentImage 系（class_type 含 "LatentImage"），或任意 inputs 同时含数值 width+height 的节点
 * 识别不全时对应项为 null 并追加 issues 说明，用户可在设置里手动指定。
 */
export function detectInjectionPoints(workflowInput: Record<string, unknown>): {mapping: ComfyUiWorkflowMappingDto; issues: string[]} {
    const issues: string[] = [];
    const mapping: ComfyUiWorkflowMappingDto = {
        positive: null,
        negative: null,
        width: null,
        height: null,
        seed: null,
        steps: null,
        cfg: null,
    };
    const nodes = Object.entries(workflowInput)
        .map(([nodeId, raw]) => [nodeId, asNode(raw)] as const)
        .filter((entry): entry is readonly [string, ComfyUiWorkflowNode] => entry[1] !== null);

    // 1. 找采样器节点。优先 class_type 匹配，兜底看 inputs 字段组合。
    const sampler = nodes.find(([, node]) => typeof node.class_type === "string" && node.class_type.includes("KSampler"))
        ?? nodes.find(([, node]) => {
            const inputs = node.inputs ?? {};
            return ("seed" in inputs || "noise_seed" in inputs) && "steps" in inputs;
        });
    if (sampler) {
        const [samplerId, samplerNode] = sampler;
        const inputs = samplerNode.inputs ?? {};
        const seedField = "seed" in inputs ? "seed" : "noise_seed" in inputs ? "noise_seed" : null;
        if (seedField) {
            mapping.seed = {nodeId: samplerId, field: seedField};
        } else {
            issues.push(`采样器节点 ${samplerId} 没有 seed/noise_seed 字段，随机种子将不注入`);
        }
        if (typeof inputs.steps === "number") {
            mapping.steps = {nodeId: samplerId, field: "steps"};
        }
        if (typeof inputs.cfg === "number") {
            mapping.cfg = {nodeId: samplerId, field: "cfg"};
        } else {
            issues.push(`采样器节点 ${samplerId} 没有数值 cfg 字段，CFG 将不注入`);
        }
        // 2. 顺 positive/negative 连线找文本编码节点。
        for (const key of ["positive", "negative"] as const) {
            const link = inputs[key];
            if (!isNodeLink(link)) {
                issues.push(`采样器节点 ${samplerId} 的 ${key} 不是节点连线，无法定位提示词节点`);
                continue;
            }
            const target = resolveTextNode(workflowInput, link[0]);
            if (target) {
                mapping[key] = target;
            } else {
                issues.push(`未能从采样器 ${key} 连线（节点 ${link[0]}）找到含 text 字段的提示词节点`);
            }
        }
    } else {
        issues.push("未找到采样器节点（KSampler 或含 seed+steps 的节点），seed/steps/cfg 与提示词需要手动指定");
    }

    // 3. 尺寸节点。
    const latent = nodes.find(([, node]) => typeof node.class_type === "string" && node.class_type.includes("LatentImage"))
        ?? nodes.find(([, node]) => {
            const inputs = node.inputs ?? {};
            return typeof inputs.width === "number" && typeof inputs.height === "number";
        });
    if (latent) {
        const [latentId, latentNode] = latent;
        const inputs = latentNode.inputs ?? {};
        if (typeof inputs.width === "number" && typeof inputs.height === "number") {
            mapping.width = {nodeId: latentId, field: "width"};
            mapping.height = {nodeId: latentId, field: "height"};
        } else {
            issues.push(`潜空间节点 ${latentId} 没有数值 width/height 字段，尺寸将不注入`);
        }
    } else {
        issues.push("未找到含 width/height 的节点，尺寸需要手动指定");
    }

    if (!mapping.positive) {
        issues.push("正向提示词注入点缺失：不指定将无法提交生图任务");
    }
    return {mapping, issues};
}

/**
 * 从起点节点出发找含字符串 text 字段的节点：起点自身有 text 直接命中；
 * 否则沿 conditioning 常见透传字段（conditioning/base 等连线）向上追一层，最多追 4 跳防环。
 */
function resolveTextNode(workflow: Record<string, unknown>, startNodeId: string): ComfyUiNodeFieldRefDto | null {
    let currentId = startNodeId;
    for (let hop = 0; hop < 4; hop += 1) {
        const node = asNode(workflow[currentId]);
        if (!node) {
            return null;
        }
        const inputs = node.inputs ?? {};
        if (typeof inputs.text === "string") {
            return {nodeId: currentId, field: "text"};
        }
        // ConditioningCombine / ConditioningSetArea 等节点：沿第一个连线继续向上。
        const nextLink = Object.values(inputs).find(isNodeLink);
        if (!nextLink) {
            return null;
        }
        currentId = nextLink[0];
    }
    return null;
}
