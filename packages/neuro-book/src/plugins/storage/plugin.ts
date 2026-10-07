import type {PluginDescriptor} from "nbook/manifest";

/**
 * 插件记录的持久化（docs/specs/storage/persistence.md）：服务端入口拥有 user 分区，项目入口拥有本项目代次的
 * project 分区，浏览器入口不存数据、以调用方的身份经远程服务转给分区的拥有者。
 */
export const descriptor: PluginDescriptor = {id: "nbook.storage", version: "0.1.0", locations: ["server", "project", "browser"]};
