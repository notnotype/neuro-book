/**
 * canon 的 Lab 场景：按组件的六个区域分文件（与 `../components/` 的子目录一一对应），这里合成一张登记表交给 Lab 收集。
 */
import type {LabFixture} from "nbook/plugins/lab/web/scene-kit";
import {fixtures as editing} from "./editing.scenes";
import {fixtures as entries} from "./entries.scenes";
import {fixtures as entryPage} from "./entry-page.scenes";
import {fixtures as groups} from "./groups.scenes";
import {fixtures as revisions} from "./revisions.scenes";
import {fixtures as text} from "./text.scenes";

export const fixtures: LabFixture[] = [...entries, ...entryPage, ...groups, ...editing, ...text, ...revisions];
