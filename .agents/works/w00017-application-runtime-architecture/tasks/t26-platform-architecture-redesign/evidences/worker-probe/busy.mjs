import {parentPort} from "node:worker_threads";
parentPort.postMessage("started");
let x = 0;
while (true) { x++; }   // 同步死循环，不让出事件循环
