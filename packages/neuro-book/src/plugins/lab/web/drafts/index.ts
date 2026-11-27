/**
 * Lab 的草稿区（docs/specs/ui/component-lab.md 的“草稿区”）：界面评审的静态稿，每个 Task 一个目录 `drafts/<Work>-<Task>/`，
 * 放草稿组件、同名文档、样本与 `fixtures.ts`（导出这个目录的场景登记 `fixtures`）。新目录放进来就会出现在 Lab 的
 * “drafts”一组里，不用改总登记表。草稿只在开发版里有（Lab 是开发插件），可以引别的插件的界面组件。
 */
import {collectLabFixtures, type LabFixture} from "../fixtures/define";

export const draftFixtures: LabFixture[] = collectLabFixtures(import.meta.glob("./*/fixtures.ts", {eager: true}));
