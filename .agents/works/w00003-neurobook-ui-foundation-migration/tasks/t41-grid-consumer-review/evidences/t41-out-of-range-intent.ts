import {createGrid} from '../../../../../../packages/nb-ui/src/components/layout/grid.ts';

/** 意图已越过当前约束（例如恢复来的旧偏好）时提交一次 resize：看总量与呈现各变成什么。 */
const axis = 'height';
const make = (id, intent, low, high) => ({
    kind: 'leaf', id, ref: id,
    size: {width: 0, height: intent},
    minimumSize: {width: 0, height: low},
    maximumSize: {width: 1000, height: high},
});
const intents = [64, 82, 195, 121];
const low = [10, 3, 4, 10];
const high = [38, 71, 219, 79];
const children = intents.map((intent, index) => make('n' + index, intent, low[index], high[index]));
const grid = createGrid({kind: 'branch', id: 'root', orientation: 'vertical', children}, {sashSize: 0});
const container = {width: 50, height: intents.reduce((sum, value) => sum + value, 0)};
const presentedBefore = grid.layout(container).sizes;
const result = grid.resize('n0', axis, -66);
const root = grid.root();
const after = root.children.map((child) => child.size[axis]);
const presentedAfter = grid.layout(container).sizes;
console.log(JSON.stringify({
    result,
    intentsBefore: intents,
    intentsAfter: after,
    sumBefore: intents.reduce((sum, value) => sum + value, 0),
    sumAfter: after.reduce((sum, value) => sum + value, 0),
    presentedBefore: Object.fromEntries(Object.entries(presentedBefore).map(([id, size]) => [id, size.height])),
    presentedAfter: Object.fromEntries(Object.entries(presentedAfter).map(([id, size]) => [id, size.height])),
    outOfBoundsAfter: after.some((value, index) => value < low[index] - 1e-9 || value > high[index] + 1e-9),
}, null, 1));
