import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

import {DEFAULT_PRESET, presetsPoint} from "./shared/contracts";

/**
 * bot（docs/specs/bots/bots.md、main-conversation.md）：按插件交出的预设建 bot、在服务端持有每个 bot 的主对话。第一版只有服务端入口，
 * 浏览器经远程服务 `nbook.bots/bots` 调它；界面在 t15。
 *
 * 缺省预设是顶层声明：路径相对内置资源的根（`backend/builtin-root.ts`）。
 */
export const descriptor: PluginDescriptor = {
    id: "nbook.bots",
    version: PRODUCT_VERSION,
    locations: ["server"],
    contributionPoints: [presetsPoint],
    contributions: [{capability: presetsPoint.id, id: DEFAULT_PRESET, declaration: {name: "星璃", avatar: "lyra/avatar.webp", profile: "nbook.bots.companion", persona: "lyra/persona.md"}}],
};
