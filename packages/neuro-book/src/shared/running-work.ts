/**
 * 在跑的工作（docs/specs/runtime/server-host.md 的“在跑的工作”）：宿主接口的地址与应答形状，服务端的路由与页面的连接对象
 * 都用这一份。登记用的宿主能力 `runningWorkKey` 在 `host.ts`。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {TextSchema} from "./text";

/** 宿主接口的完整路径（与 `/api/runtime/health` 同属宿主自有接口）。 */
export const RUNNING_WORK_PATH = "/api/runtime/work";

export const RunningWorkReportSchema = Type.Object({
    /** 服务端的项 `project` 为 null。 */
    items: Type.Array(Type.Object({plugin: Type.String(), project: Type.Union([Type.String(), Type.Null()]), text: TextSchema})),
    /** 登记方抛错的插件、取不到的项目（这时 `plugin` 为 null）。 */
    failed: Type.Array(Type.Object({plugin: Type.Union([Type.String(), Type.Null()]), project: Type.Union([Type.String(), Type.Null()])})),
});

export type RunningWorkReport = Static<typeof RunningWorkReportSchema>;
