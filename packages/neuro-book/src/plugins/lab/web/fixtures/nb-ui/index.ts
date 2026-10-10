/**
 * nb-ui 组件的场景（组件树里 `nb-ui` 一组）。按 nb-ui 的分类分文件，由 `fixtures/index.ts` 合并进总登记；
 * 组件文档与实现在 nb-ui 包里，经它的公开入口 `@notnotype/nb-ui/lab-sources` 进组件索引。
 */

import type {LabFixture} from "../index";
import {controlsFixtures} from "./controls";
import {displayFixtures} from "./display";
import {feedbackFixtures} from "./feedback";
import {formFixtures} from "./form";
import {layoutFixtures} from "./layout";

export const nbUiFixtures: LabFixture[] = [...controlsFixtures, ...displayFixtures, ...feedbackFixtures, ...formFixtures, ...layoutFixtures];
