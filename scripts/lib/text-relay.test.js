'use strict';

// #1410 —— text-relay：攒批、换轮先发、空串不发。计时器换成手动的，读数不靠等。
const assert = require('assert');
const { createTextRelay } = require('./text-relay');

function rig() {
  const out = [];
  const timers = [];
  const relay = createTextRelay((event, data) => out.push({ event, ...data }), {
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
  });
  return { out, timers, relay, fire: () => { const fn = timers.shift(); if (fn) fn(); } };
}

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}

test('几个 delta 攒成一条，计时器到点才发', () => {
  const { out, relay, fire } = rig();
  relay.begin(0, 0);
  relay.push('Hel');
  relay.push('lo');
  assert.strictEqual(out.length, 0);
  fire();
  assert.deepStrictEqual(out, [{ event: 'text', delta: 'Hello', turn: 0, attempt: 0 }]);
});

test('换一轮之前先把上一轮的发掉，带的是上一轮的号', () => {
  const { out, relay } = rig();
  relay.begin(0, 0);
  relay.push('a');
  relay.begin(0, 1);
  relay.push('b');
  relay.flush();
  assert.deepStrictEqual(out.map((o) => [o.delta, o.turn, o.attempt]), [['a', 0, 0], ['b', 0, 1]]);
});

test('没有字就不发（空串、非字符串、重复 flush）', () => {
  const { out, relay } = rig();
  relay.begin(1, 0);
  relay.push('');
  relay.push(undefined);
  relay.flush();
  relay.flush();
  assert.strictEqual(out.length, 0);
});

if (failed) { console.log(`${failed} failed`); process.exit(1); }
