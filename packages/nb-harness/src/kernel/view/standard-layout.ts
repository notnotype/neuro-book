/**
 * 缺省布局：`<System>`（Profile 的 system 加稳定的槽）、开场槽、历史、进行中的这一轮、会变的槽。
 * 不写 `prompt` 的 Profile 就用它；`helpers/` 把它作为 helper 导出。
 */

import type {StandardLayoutHelper} from "../api/index.js";
import {Fragment, History, Slot, System, Turn, User} from "./prompt/nodes.js";

export const standardLayout: StandardLayoutHelper = (options = {}) => () => {
    const history = options.history ?? true;
    const volatile = Slot({name: "*", volatile: true});
    return Fragment({children: [
        System({children: [System({}), Slot({name: "*", stable: true})]}),
        User({children: [Slot({name: "opening"})]}),
        history === false ? null : History(history === true ? {} : {last: history.last}),
        options.volatile === "before-turn" ? volatile : null,
        Turn({}),
        options.volatile === "before-turn" ? null : volatile,
    ]});
};
