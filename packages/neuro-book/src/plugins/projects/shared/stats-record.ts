/**
 * 作品统计的持久记录（docs/specs/runtime/projects.md 输出第 16 条）：user 分区、按项目 id 寻址、同一用户的全部客户端共用一份。
 * 项目实例在运行中写它，服务端的 `shelf` 对没在运行的作品读它。它是可重算的缓存：坏记录由写入方条件 reset，不需要迁移。
 */

import {defineRecord} from "nbook/shared/storage";

import {ProjectStatsSnapshotSchema} from "./contracts";

export const PROJECT_STATS_RECORD = defineRecord({key: "projects.stats", scope: "user", locality: "shared", version: 1, keyed: true, schema: ProjectStatsSnapshotSchema});
