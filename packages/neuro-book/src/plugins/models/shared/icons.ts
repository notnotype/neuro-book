/**
 * 上传的服务商图标的读取地址（docs/specs/models/service.md 输出 21）：设置页与别的插件（Agent 的模型选择器）都按它取，地址只在这里拼。
 * 文件名由设置的 schema 限定为 64 位十六进制加 `.png`，直接拼进路径。
 */

import {descriptor} from "../plugin";

export const providerIconUrl = (name: string): string => `/api/${descriptor.id}/icons/${name}`;
