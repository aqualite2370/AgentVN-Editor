import { nanoid } from "nanoid";
import type { Choice, ChoiceCommand } from "../../types/commands";
import { conditionToRuntimeCondition, defaultConditionData, runtimeConditionToConditionData } from "../../utils/conditions";
import { FieldHelp } from "../common/FieldHelp";
import { ConditionBuilderEditor } from "./ConditionBuilderEditor";

function createChoiceId(): string {
  return "choice_" + nanoid(6);
}

function normalizeChoice(choice: Choice): Choice {
  return {
    ...choice,
    text: choice.text ?? "",
    choice_display_name: choice.choice_display_name ?? null,
    conditions: choice.conditions ?? [],
  };
}

function choiceTextInputValue(choice: Choice): string {
  return choice.text || choice.choice_display_name || "";
}

export function ChoiceCommandEditor({
  command,
  variableKeys = [],
  onChange,
}: {
  command: ChoiceCommand;
  variableKeys?: string[];
  onChange: (command: ChoiceCommand) => void;
}) {
  const updateChoice = (index: number, choice: Choice) => {
    const choices = [...command.choices];
    choices[index] = normalizeChoice(choice);
    onChange({ ...command, choices });
  };

  const addCondition = (choiceIndex: number) => {
    const choice = normalizeChoice(command.choices[choiceIndex]);
    updateChoice(choiceIndex, {
      ...choice,
      conditions: [...choice.conditions, conditionToRuntimeCondition(defaultConditionData())],
    });
  };

  const updateCondition = (choiceIndex: number, conditionIndex: number, condition: Choice["conditions"][number]) => {
    const choice = normalizeChoice(command.choices[choiceIndex]);
    updateChoice(choiceIndex, {
      ...choice,
      conditions: choice.conditions.map((item, index) => index === conditionIndex ? condition : item),
    });
  };

  const removeCondition = (choiceIndex: number, conditionIndex: number) => {
    const choice = normalizeChoice(command.choices[choiceIndex]);
    updateChoice(choiceIndex, {
      ...choice,
      conditions: choice.conditions.filter((_, index) => index !== conditionIndex),
    });
  };

  return (
    <div className="choice-editor">
      {command.choices.map((rawChoice, index) => {
        const choice = normalizeChoice(rawChoice);
        return (
          <div className="choice-row" key={choice.choice_id}>
            <input
              value={choice.choice_id}
              placeholder="选项稳定 ID"
              data-help-key="command.choice.choiceId"
              onChange={(event) => updateChoice(index, { ...choice, choice_id: event.target.value })}
            />
            <input
              value={choiceTextInputValue(choice)}
              placeholder="选项显示名 / 玩家看到的选项文本"
              data-help-key="command.choice.text"
              onChange={(event) => {
                const nextText = event.target.value;
                updateChoice(index, {
                  ...choice,
                  choice_display_name: nextText || null,
                  text: nextText,
                });
              }}
            />
            <input
              value={choice.target_scene_id}
              placeholder="从本选项连线到目标场景后自动填入"
              data-help-key="command.choice.targetSceneId"
              onChange={(event) => updateChoice(index, { ...choice, target_scene_id: event.target.value })}
            />
            <button type="button" data-help-key="command.delete" onClick={() => onChange({ ...command, choices: command.choices.filter((_, itemIndex) => itemIndex !== index) })}>
              删除
            </button>
            <details className="choice-condition-panel">
              <summary>显示条件 {choice.conditions.length > 0 ? `(${choice.conditions.length})` : ""}</summary>
              <div className="choice-condition-list">
                {choice.conditions.map((condition, conditionIndex) => (
                  <section className="choice-condition-item" key={`${choice.choice_id}-${conditionIndex}`}>
                    <ConditionBuilderEditor
                      condition={runtimeConditionToConditionData(condition)}
                      variableKeys={variableKeys}
                      datalistId={`choice-condition-variable-${choice.choice_id}-${conditionIndex}`}
                      showExitLabels={false}
                      onChange={(nextCondition) => updateCondition(index, conditionIndex, conditionToRuntimeCondition(nextCondition))}
                    />
                    <button type="button" data-help-key="command.choice.conditionDelete" onClick={() => removeCondition(index, conditionIndex)}>
                      删除条件
                    </button>
                  </section>
                ))}
                <button type="button" data-help-key="command.choice.conditionAdd" onClick={() => addCondition(index)}>
                  添加显示条件
                </button>
              </div>
            </details>
          </div>
        );
      })}
      <button
        type="button"
        data-help-key="command.choice.add"
        onClick={() =>
          onChange({
            ...command,
            choices: [
              ...command.choices,
              {
                choice_id: createChoiceId(),
                choice_display_name: null,
                text: "",
                target_scene_id: "",
                conditions: [],
              },
            ],
          })
        }
      >
        添加选项 <FieldHelp field="choices" />
      </button>
    </div>
  );
}
