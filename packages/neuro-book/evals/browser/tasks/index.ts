/** 题目登记表。第一阶段的 8 道题见实施计划“8 道题”。 */

import {authorIncome, authorMove, authorPublish} from "./author";
import {forumPost, forumVerify, forumVote} from "./forum";
import {readerFont, readerRank} from "./reader";
import type {TaskDefinition} from "./types";

export const TASKS: readonly TaskDefinition[] = [authorPublish, authorMove, authorIncome, readerRank, readerFont, forumPost, forumVote, forumVerify];

export const PHASE1 = TASKS.map((task) => task.id);

export function taskById(id: string): TaskDefinition {
    const task = TASKS.find((item) => item.id === id);
    if (task === undefined) throw new Error(`unknown task: ${id}`);
    return task;
}
