/**
 * 定义 Profile。与 `defineExtension` 一样只包成对象并打上标记；id 规则（t05 的 key）与派生规则在装配时检查。
 */

import type {DefineProfile} from "../api/index.js";
import {EXTENSION} from "./define.js";

export const PROFILE = Symbol.for("nb-harness.kernel.profile");

export const defineProfile: DefineProfile = (spec) => ({...spec, events: spec.events ?? {}, [EXTENSION]: true, [PROFILE]: true}) as never;
