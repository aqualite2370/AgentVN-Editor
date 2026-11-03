import assert from "node:assert/strict";
import {
  orderedVisibleSprites,
  resolveSpriteSlotIndices,
  resolveSpriteSlotLayout,
} from "../GameCli_framework/src/engine/spriteStageLayout.ts";

const stage = { width: 1280, height: 720, uiScale: 1 };
const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
};

const centered = resolveSpriteSlotLayout({
  stage,
  spriteCount: 1,
  spriteIndex: 0,
  position: "center",
});
close(centered.left, 409.6);
close(centered.bottom, 52);
close(centered.width, 460.8);
close(centered.height, 662.4);

const left = resolveSpriteSlotLayout({
  stage,
  spriteCount: 1,
  spriteIndex: 0,
  position: "left",
});
const right = resolveSpriteSlotLayout({
  stage,
  spriteCount: 1,
  spriteIndex: 0,
  position: "right",
});
close(left.left, 89.6);
close(right.left, 729.6);

const pair = [0, 1].map((spriteIndex) => resolveSpriteSlotLayout({
  stage,
  spriteCount: 2,
  spriteIndex,
  position: spriteIndex === 0 ? "left" : "right",
}));
close(pair[0].width, 435.2);
close(pair[0].left, 147.2);
close(pair[1].left, 697.6);
assert.ok(pair[0].left + pair[0].width < pair[1].left);

const rightFirstSprites = {
  right_character: {
    character_id: "right_character",
    sprite_id: "right_sprite",
    position: "right",
    visible: true,
  },
  left_character: {
    character_id: "left_character",
    sprite_id: "left_sprite",
    position: "left",
    visible: true,
  },
};
const rightFirstOrder = orderedVisibleSprites(rightFirstSprites, ["right_character", "left_character"]);
const rightFirstSlots = resolveSpriteSlotIndices(rightFirstOrder);
assert.equal(rightFirstSlots.get("left_character"), 0, "explicit left position must own the left slot");
assert.equal(rightFirstSlots.get("right_character"), 1, "explicit right position must own the right slot");
const rightFirstLayouts = rightFirstOrder.map((sprite) => resolveSpriteSlotLayout({
  stage,
  spriteCount: rightFirstOrder.length,
  spriteIndex: rightFirstSlots.get(sprite.character_id),
  position: sprite.position,
}));
assert.ok(
  rightFirstLayouts[rightFirstOrder.findIndex((sprite) => sprite.character_id === "left_character")].left
    < rightFirstLayouts[rightFirstOrder.findIndex((sprite) => sprite.character_id === "right_character")].left,
  "right-first appearance order must not swap explicit left/right placement",
);

const threePositionSprites = [
  { character_id: "right", sprite_id: "right", position: "right", visible: true },
  { character_id: "left", sprite_id: "left", position: "left", visible: true },
  { character_id: "center", sprite_id: "center", position: "center", visible: true },
];
const threePositionSlots = resolveSpriteSlotIndices(threePositionSprites);
assert.deepEqual(
  Object.fromEntries(threePositionSlots),
  { left: 0, center: 1, right: 2 },
  "all explicit positions must map to canonical three-person slots",
);

const duplicatePositionSprites = [
  { character_id: "left_first", sprite_id: "left_first", position: "left", visible: true },
  { character_id: "left_second", sprite_id: "left_second", position: "left", visible: true },
  { character_id: "unknown", sprite_id: "unknown", position: "mystery", visible: true },
];
const duplicatePositionSlots = resolveSpriteSlotIndices(duplicatePositionSprites);
assert.equal(new Set(duplicatePositionSlots.values()).size, duplicatePositionSprites.length);
assert.equal(duplicatePositionSlots.get("left_first"), 0);

const five = Array.from({ length: 5 }, (_, spriteIndex) => resolveSpriteSlotLayout({
  stage,
  spriteCount: 5,
  spriteIndex,
  position: "center",
}));
assert.ok(five.every((slot) => Math.abs(slot.width - 230.4) <= 1e-9));
assert.ok(five.every((slot, index) => index === 0 || slot.left > five[index - 1].left));
assert.ok(five[0].left >= 0);
assert.ok(five.at(-1).left + five.at(-1).width <= stage.width);

console.log("sprite stage layout: PASS");
