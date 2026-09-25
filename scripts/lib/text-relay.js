'use strict';

// #1410 —— 把模型边写边出的字发出去：`{"event":"text","delta":"…","turn":N,"attempt":M}`。
//
// 🔴 为什么要攒一批：worker 对 stdout 的**每一行**都 `rdb.Publish` 一次、打一行日志（`worker/main.go`
//    §processEditTask 扫 stdout 那一段）。一个 token 一行，一次编辑就是几百次发布、几百行日志。按 `flushMs`
//    攒一批，界面上看起来仍然是一个字一个字出来的，发布次数降到每秒二十次以内。
// 🔴 `turn` / `attempt`：一次编辑是好几轮工具调用，每一轮模型都会说几句话；某一轮 API 出错重试时，
//    那一轮已经发出去的字要作废（重试会从头再说一遍）。收的那一侧看到同一个 `turn` 换了 `attempt`，
//    就把这一轮的字清掉重来 —— 不然界面上会出现同一句话说了两遍。
// 📌 这些字只用来「看着它在写」。落进聊天记录的那一条仍然是 `edit-complete` 的 `message`，跟今天一样。

function createTextRelay(emit, { flushMs = 50, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let buf = '';
  let timer = null;
  let turn = 0;
  let attempt = 0;
  function flush() {
    if (timer) { clearTimer(timer); timer = null; }
    if (!buf) return;
    emit('text', { delta: buf, turn, attempt });
    buf = '';
  }
  return {
    // 开始新的一轮（或同一轮的重试）：先把手上攒着的发出去，它属于上一轮。
    begin(nextTurn, nextAttempt) {
      flush();
      turn = nextTurn;
      attempt = nextAttempt;
    },
    push(delta) {
      if (typeof delta !== 'string' || !delta) return;
      buf += delta;
      if (!timer) timer = setTimer(flush, flushMs);
    },
    flush,
  };
}

module.exports = { createTextRelay };
