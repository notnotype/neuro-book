/**
 * 世界引擎的作品设置（docs/specs/canon/time.md 输入表的“历法”“模糊词表”）：只允许项目层（历法是一部作品的）。schema 放宽为对象，
 * 合法性由 nb-time 按输出 13 查：这样不合法时才能沿用最近一次合法的历法，而不是在设置这一层就被拒掉。
 */

import {Type} from "typebox";

import {defineSettings} from "nbook/shared/settings";

const Loose = Type.Union([Type.Null(), Type.Record(Type.String(), Type.Unknown())]);

export const canonSettings = defineSettings("nbook.canon", {
    calendar: {
        schema: Loose,
        default: null,
        title: {"zh-CN": "历法", "en-US": "Calendar"},
        description: {"zh-CN": "这部作品的时间单位、各月、闰年规则、纪年与时段；不填时用公历。", "en-US": "This work's time unit, months, leap rules, eras and periods; the Gregorian calendar when empty."},
        layers: ["project"],
    },
    fuzzyWords: {
        schema: Loose,
        default: null,
        title: {"zh-CN": "模糊时间词", "en-US": "Fuzzy time words"},
        description: {"zh-CN": "“几天”“多年”这类词对应的范围，与“约”放宽多少；不填时用内置的一份。", "en-US": "Ranges for words like “a few days” or “years”, and how much “about” widens a date; a built-in table when empty."},
        layers: ["project"],
    },
});
