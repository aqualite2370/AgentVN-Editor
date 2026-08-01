# Loop Nodes and Jump Events

## Runtime shape

AgentVN supports two complementary control-flow tools:

- jump: an unconditional event command that immediately enters target_scene_id.
- loop node: an editor graph node for repeated battle, search, patrol, or investigation beats.

Loop nodes are editor authoring helpers. Export converts each loop node into a normal runtime scene with:

1. state_update using set_if_unset to initialize the loop variable without resetting it on back-jumps.
2. state_update using add or another numeric step to advance the loop counter.
3. conditional_jump that sends true results to the loop handle and false results to the exit handle.

The exported script.json must not contain editor-only fields such as loopLabel, exitLabel, variableKey, or node inspector metadata.

## Authoring rules

- Use jump when the event should always move to one scene, such as returning from a battle round to the loop controller.
- Use conditional_jump when the target depends on runtime variables, such as hero_hp <= 0.
- Use a loop node when a repeated structure needs a visible controller with a clear continue and exit branch.
- A loop node must have both loop and exit outgoing handles connected before publishing.
- Release preflight validates jump, conditional_jump, and loop-generated targets before export/package.

## Example patterns

- Battle loop: initialize enemy_hp and hero_hp, jump to the loop node, execute a round, then jump back until the enemy reaches zero; a separate conditional jump can route hero_hp <= 0 to failure.
- Search loop: initialize search_count, increment each pass, investigate the room, and exit once the key item is found.
- Safety: Runtime keeps the automatic jump guard. If a script loops through non-blocking commands too many times without dialog, choice, wait, or another blocking event, GameCLI pauses and shows a Chinese dead-loop protection hint instead of black-screening.

## State operations

state_update.operation supports set, set_if_unset, add, subtract, toggle, append, and remove.

Use set_if_unset for loop initialization because it preserves the current loop counter after a back-jump. Use set only when the scene should deliberately reset the variable.
