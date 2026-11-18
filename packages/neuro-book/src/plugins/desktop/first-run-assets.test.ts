/**
 * 首次启动向导的主题缩略图（web/first-run-assets.ts）与内置主题一一对应：加了内置主题没补图、删了主题留着图，这里都会失败。
 * 外观是否过时不在这里核对：产品外观变了按 `scripts/first-run-thumbnails.ts` 重截。
 */

import {describe, expect, it} from "bun:test";
import {readdir, stat} from "node:fs/promises";
import {fileURLToPath} from "node:url";

import {descriptor as themeStudy} from "nbook/plugins/theme-study/plugin";
import {WORKBENCH_THEMES_POINT} from "nbook/plugins/workbench/shared/contracts";
import {BUILTIN_THEME_CONTRIBUTIONS} from "nbook/plugins/workbench/shared/themes";

import {FIRST_RUN_THUMBNAILS} from "./web/first-run-assets";

describe("首次启动向导的主题缩略图", () => {
    it("每个内置主题亮、暗各一张，没有多余的文件", async () => {
        const studyThemes = (themeStudy.contributions ?? []).filter((entry) => entry.capability === WORKBENCH_THEMES_POINT).map((entry) => entry.id);
        const ids = [...BUILTIN_THEME_CONTRIBUTIONS.map((entry) => entry.id), ...studyThemes].sort();
        expect(Object.keys(FIRST_RUN_THUMBNAILS).sort()).toEqual(ids);
        const expected = ids.flatMap((id) => [`${id}-dark.webp`, `${id}-light.webp`]).sort();
        const files = (await readdir(new URL("./web/assets/first-run/", import.meta.url))).sort();
        expect(files).toEqual(expected);
        for (const thumbnails of Object.values(FIRST_RUN_THUMBNAILS)) {
            for (const url of [thumbnails.light, thumbnails.dark]) expect((await stat(fileURLToPath(url))).size).toBeGreaterThan(1000);
        }
    });
});
