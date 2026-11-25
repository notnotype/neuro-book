/**
 * 图标文件的地址表，按文件名取。单独成模块、由 `index.ts` 动态导入：几十个 SVG 不进首屏包（小于 4 KB 的会被 Vite 内联成 data 地址）。
 * 文件名集合要与 `files.ts` 一致，`provider-icons.test.ts` 核对。
 */
import icon0 from "@lobehub/icons-static-svg/icons/aimlapi.svg?url";
import icon1 from "@lobehub/icons-static-svg/icons/alibabacloud-color.svg?url";
import icon2 from "@lobehub/icons-static-svg/icons/antigravity-color.svg?url";
import icon3 from "@lobehub/icons-static-svg/icons/azure-color.svg?url";
import icon4 from "@lobehub/icons-static-svg/icons/baseten.svg?url";
import icon5 from "@lobehub/icons-static-svg/icons/bedrock-color.svg?url";
import icon6 from "@lobehub/icons-static-svg/icons/cerebras.svg?url";
import icon7 from "@lobehub/icons-static-svg/icons/claude-color.svg?url";
import icon8 from "@lobehub/icons-static-svg/icons/cline.svg?url";
import icon9 from "@lobehub/icons-static-svg/icons/cloudflare-color.svg?url";
import icon10 from "@lobehub/icons-static-svg/icons/codex-color.svg?url";
import icon11 from "@lobehub/icons-static-svg/icons/commandcode.svg?url";
import icon12 from "@lobehub/icons-static-svg/icons/cursor.svg?url";
import icon13 from "@lobehub/icons-static-svg/icons/deepinfra-color.svg?url";
import icon14 from "@lobehub/icons-static-svg/icons/deepseek-color.svg?url";
import icon15 from "@lobehub/icons-static-svg/icons/devin-color.svg?url";
import icon16 from "@lobehub/icons-static-svg/icons/fireworks-color.svg?url";
import icon17 from "@lobehub/icons-static-svg/icons/gemini-color.svg?url";
import icon18 from "@lobehub/icons-static-svg/icons/geminicli-color.svg?url";
import icon19 from "@lobehub/icons-static-svg/icons/githubcopilot.svg?url";
import icon20 from "@lobehub/icons-static-svg/icons/gmicloud.svg?url";
import icon21 from "@lobehub/icons-static-svg/icons/groq.svg?url";
import icon22 from "@lobehub/icons-static-svg/icons/huggingface-color.svg?url";
import icon23 from "@lobehub/icons-static-svg/icons/inception.svg?url";
import icon24 from "@lobehub/icons-static-svg/icons/kilocode.svg?url";
import icon25 from "@lobehub/icons-static-svg/icons/kimi.svg?url";
import icon26 from "@lobehub/icons-static-svg/icons/lmstudio.svg?url";
import icon27 from "@lobehub/icons-static-svg/icons/meta-color.svg?url";
import icon28 from "@lobehub/icons-static-svg/icons/minimax-color.svg?url";
import icon29 from "@lobehub/icons-static-svg/icons/mistral-color.svg?url";
import icon30 from "@lobehub/icons-static-svg/icons/muse-color.svg?url";
import icon31 from "@lobehub/icons-static-svg/icons/novita-color.svg?url";
import icon32 from "@lobehub/icons-static-svg/icons/nvidia-color.svg?url";
import icon33 from "@lobehub/icons-static-svg/icons/ollama.svg?url";
import icon34 from "@lobehub/icons-static-svg/icons/openai.svg?url";
import icon35 from "@lobehub/icons-static-svg/icons/opencode.svg?url";
import icon36 from "@lobehub/icons-static-svg/icons/openrouter-color.svg?url";
import icon37 from "@lobehub/icons-static-svg/icons/qwen-color.svg?url";
import icon38 from "@lobehub/icons-static-svg/icons/sakana-color.svg?url";
import icon39 from "@lobehub/icons-static-svg/icons/sambanova-color.svg?url";
import icon40 from "@lobehub/icons-static-svg/icons/siliconcloud-color.svg?url";
import icon41 from "@lobehub/icons-static-svg/icons/snowflake-color.svg?url";
import icon42 from "@lobehub/icons-static-svg/icons/stepfun-color.svg?url";
import icon43 from "@lobehub/icons-static-svg/icons/together-color.svg?url";
import icon44 from "@lobehub/icons-static-svg/icons/venice-color.svg?url";
import icon45 from "@lobehub/icons-static-svg/icons/vercel.svg?url";
import icon46 from "@lobehub/icons-static-svg/icons/vertexai-color.svg?url";
import icon47 from "@lobehub/icons-static-svg/icons/vllm-color.svg?url";
import icon48 from "@lobehub/icons-static-svg/icons/wafer.svg?url";
import icon49 from "@lobehub/icons-static-svg/icons/wenxin-color.svg?url";
import icon50 from "@lobehub/icons-static-svg/icons/workersai-color.svg?url";
import icon51 from "@lobehub/icons-static-svg/icons/xai.svg?url";
import icon52 from "@lobehub/icons-static-svg/icons/xiaomimimo.svg?url";
import icon53 from "@lobehub/icons-static-svg/icons/zenmux.svg?url";
import icon54 from "@lobehub/icons-static-svg/icons/zhipu-color.svg?url";
import icon55 from "@lobehub/icons-static-svg/icons/tavily-color.svg?url";

export const ICON_URLS: Readonly<Record<string, string>> = {
    "aimlapi.svg": icon0,
    "alibabacloud-color.svg": icon1,
    "antigravity-color.svg": icon2,
    "azure-color.svg": icon3,
    "baseten.svg": icon4,
    "bedrock-color.svg": icon5,
    "cerebras.svg": icon6,
    "claude-color.svg": icon7,
    "cline.svg": icon8,
    "cloudflare-color.svg": icon9,
    "codex-color.svg": icon10,
    "commandcode.svg": icon11,
    "cursor.svg": icon12,
    "deepinfra-color.svg": icon13,
    "deepseek-color.svg": icon14,
    "devin-color.svg": icon15,
    "fireworks-color.svg": icon16,
    "gemini-color.svg": icon17,
    "geminicli-color.svg": icon18,
    "githubcopilot.svg": icon19,
    "gmicloud.svg": icon20,
    "groq.svg": icon21,
    "huggingface-color.svg": icon22,
    "inception.svg": icon23,
    "kilocode.svg": icon24,
    "kimi.svg": icon25,
    "lmstudio.svg": icon26,
    "meta-color.svg": icon27,
    "minimax-color.svg": icon28,
    "mistral-color.svg": icon29,
    "muse-color.svg": icon30,
    "novita-color.svg": icon31,
    "nvidia-color.svg": icon32,
    "ollama.svg": icon33,
    "openai.svg": icon34,
    "opencode.svg": icon35,
    "openrouter-color.svg": icon36,
    "qwen-color.svg": icon37,
    "sakana-color.svg": icon38,
    "sambanova-color.svg": icon39,
    "siliconcloud-color.svg": icon40,
    "snowflake-color.svg": icon41,
    "stepfun-color.svg": icon42,
    "tavily-color.svg": icon55,
    "together-color.svg": icon43,
    "venice-color.svg": icon44,
    "vercel.svg": icon45,
    "vertexai-color.svg": icon46,
    "vllm-color.svg": icon47,
    "wafer.svg": icon48,
    "wenxin-color.svg": icon49,
    "workersai-color.svg": icon50,
    "xai.svg": icon51,
    "xiaomimimo.svg": icon52,
    "zenmux.svg": icon53,
    "zhipu-color.svg": icon54,
};
