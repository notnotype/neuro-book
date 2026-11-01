import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

import {modelsSettings} from "./shared/settings";

/**
 * 模型服务（docs/specs/models/service.md）：服务商与模型、凭据库、模型角色，给 harness 内核的模型端口。服务端入口拥有
 * 全部数据与写入；密钥不出服务端。
 */
export const descriptor: PluginDescriptor = {
    id: "nbook.models",
    version: PRODUCT_VERSION,
    locations: ["server"],
    contributions: [...modelsSettings.contributions],
};
