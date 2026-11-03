"use strict";
// QA only: heap URL presence is not proof that an Audio object played.
const assert = require("node:assert/strict");

function attributeAudio({ first, later, bgm, events, assets }) {
  assert(Array.isArray(first) && Array.isArray(later));
  assert(bgm && Array.isArray(events) && Array.isArray(assets));
  for (const a of [...first, ...later]) assert(!a.error, `Audio decode error: ${a.src}`);
  const observedPlayback = a => a.readyState >= 2 && a.duration > 0
    && (!a.paused || a.ended || a.currentTime > 0);
  const initial = first.filter(observedPlayback);
  const subsequent = later.filter(observedPlayback);
  const voice = [...new Set(initial.filter(a => a.src !== bgm).map(a => a.src))];
  const sfx = [...new Set(subsequent.filter(a => !initial.some(f => f.src === a.src)).map(a => a.src))];
  assert.equal(voice.length, 1, "Exactly one played voice source in the dialogue phase");
  assert.equal(sfx.length, 1, "Exactly one newly played SFX source in the following phase");
  assert.equal(new Set([bgm, voice[0], sfx[0]]).size, 3);
  const players = new Map();
  for (const group of events) {
    assert(group.playerId && Array.isArray(group.events));
    const list = players.get(group.playerId) || [];
    list.push(...group.events.map(e => JSON.parse(e.value)));
    players.set(group.playerId, list);
  }
  const result = [["bgm", bgm, initial], ["voice", voice[0], initial], ["sfx", sfx[0], subsequent]]
    .map(([type, src, observed]) => {
      const objects = observed.filter(a => a.src === src);
      assert.equal(objects.length, 1, `Duplicate played ${type} objects`);
      const object = objects[0], expected = assets.find(a => a.type === type);
      assert(expected);
      assert.equal(object.sha256, expected.sha256, `Actual ${type} bytes`);
      const played = [...players].filter(([, es]) => es.some(e => e.event === "kLoad" && e.url === src)
        && es.some(e => e.event === "kPlay"));
      assert.equal(played.length, 1, `Exactly one actual ${type} playback pipeline`);
      assert(played[0][1].some(e => e.pipeline_state === "kPlaying"), `Missing ${type} decoder playback`);
      return { type, ...object, decoded: true, played: true, pipelinePlaying: true, playerId: played[0][0] };
    });
  assert.equal(new Set(result.map(a => a.playerId)).size, 3);
  return result;
}

module.exports = { attributeAudio };
