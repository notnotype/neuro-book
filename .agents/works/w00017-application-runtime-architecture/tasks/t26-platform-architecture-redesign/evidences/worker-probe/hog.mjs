import {parentPort} from "node:worker_threads";
const keep = [];
for (let i = 0; i < 60; i++) {            // 最多约 600MB，防止限额无效时失控
  keep.push(new Array(10 * 1024 * 1024 / 8).fill(i));
  parentPort.postMessage(i);
}
parentPort.postMessage("done-without-limit");
