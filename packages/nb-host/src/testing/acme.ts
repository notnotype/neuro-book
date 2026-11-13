/**
 * 测试里的应用 `acme`：认领档案带一个应用自己的字段。只给本包的测试与它们起的子进程用。
 */

import {Type} from "typebox";

import {defineClaimProfile} from "../server/claim";

export const ACME_CLAIM = defineClaimProfile({socketPrefix: "acme", version: "9.9.9", fields: {modules: Type.Object({count: Type.Integer()})}});
