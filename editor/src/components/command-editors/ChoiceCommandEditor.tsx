import { Paintbrush, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useState } from "react";
import type { UILayoutComponentStyle, UISkinLayout } from "../../../../shared/cartridge/uiSkin";
import { getDefaultUISkinLayout } from "../../../../shared/cartridge/uiSkin";
import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import type { Choice, ChoiceCommand } from "../../types/commands";
import { conditionToRuntimeCondition, defaultConditionData, runtimeConditionToConditionData } from "../../utils/conditions";
import { FieldHelp } from "../common/FieldHelp";
import { ChoiceButtonStyleStudioDialog, type ChoiceButtonStyleScope } from "./ChoiceButtonStyleStudioDialog";
import { ConditionBuilderEditor } from "./ConditionBuilderEditor";

function createChoiceId(): string {
  return `choice_${nanoid(6)}`;
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

function withoutButtonStyle(choice: Choice): Choice {
  const next = { ...choice };
  delete next.button_style;
  return next;
}

function withProjectChoiceStyle(layout: UISkinLayout | undefined, style: UILayoutComponentStyle): UISkinLayout {
  const source = structuredClone(layout ?? getDefaultUISkinLayout());
  return {
    ...source,
    screens: source.screens.map((screen) => {
      if (screen.screen_id !== "player") return screen;
      const hasChoiceOption = screen.components.some((component) => component.component_type === "choice_option");
      const components = hasChoiceOption
        ? screen.components.map((component) => component.component_type === "choice_option"
          ? { ...component, style }
          : component)
        : [
            ...screen.components,
            {
              component_id: "choice_option",
              component_type: "choice_option" as const,
              label: "选项按钮",
              required: true,
              style,
              zIndex: 41,
            },
          ];
      return { ...screen, components };
    }),
  };
}

function clearProjectChoiceOverrides() {
  const editor = useEditorStore.getState();
  editor.setNodes(editor.nodes.map((node) => {
    const choice = node.data.choice
      ? {
          ...node.data.choice,
          button_style: undefined,
          choices: node.data.choice.choices.map(withoutButtonStyle),
        }
      : undefined;
    const scene = node.data.scene
      ? {
          ...node.data.scene,
          commands: node.data.scene.commands.map((command) => command.type === "choice"
            ? {
                ...command,
                button_style: undefined,
                choices: command.choices.map(withoutButtonStyle),
              }
            : command),
        }
      : undefined;
    return {
      ...node,
      data: {
        ...node.data,
        ...(choice ? { choice } : {}),
        ...(scene ? { scene } : {}),
      },
    };
  }));
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
  const [styleChoiceIndex, setStyleChoiceIndex] = useState<number>();

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

  function applyButtonStyle(
    choiceIndex: number,
    style: UILayoutComponentStyle,
    scope: ChoiceButtonStyleScope,
  ) {
    if (scope === "button") {
      updateChoice(choiceIndex, { ...normalizeChoice(command.choices[choiceIndex]), button_style: style });
    } else if (scope === "scene") {
      onChange({
        ...command,
        button_style: style,
        choices: command.choices.map(withoutButtonStyle),
      });
    } else {
      const project = useProjectStore.getState();
      project.setRuntimeUILayout(withProjectChoiceStyle(project.settings.runtimeUILayout, style));
      clearProjectChoiceOverrides();
    }
    setStyleChoiceIndex(undefined);
  }

  return (
    <div className="choice-editor">
      {command.choices.map((rawChoice, index) => {
        const choice = normalizeChoice(rawChoice);
        return (
          <div className="choice-row" key={choice.choice_id}>
            <div className="choice-text-control">
              <span>选项 {index + 1}</span>
              <input
                value={choiceTextInputValue(choice)}
                placeholder="玩家看到的选项文本"
                data-help-key="command.choice.text"
                aria-label={`选项 ${index + 1} 文本`}
                onChange={(event) => {
                  const nextText = event.target.value;
                  updateChoice(index, {
                    ...choice,
                    choice_display_name: nextText || null,
                    text: nextText,
                  });
                }}
              />
            </div>
            <button
              type="button"
              className="choice-style-launch"
              data-help-key="command.choice.buttonStyle"
              onClick={() => setStyleChoiceIndex(index)}
            >
              <Paintbrush size={16} />
              编辑按钮样式
            </button>
            <button
              type="button"
              className="choice-delete"
              aria-label={`删除选项 ${index + 1}`}
              data-help-key="command.delete"
              onClick={() => onChange({
                ...command,
                choices: command.choices.filter((_, itemIndex) => itemIndex !== index),
              })}
            >
              <Trash2 size={16} />
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
                    <button
                      type="button"
                      data-help-key="command.choice.conditionDelete"
                      onClick={() => removeCondition(index, conditionIndex)}
                    >
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
        className="choice-add"
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

      {styleChoiceIndex !== undefined && command.choices[styleChoiceIndex] && (
        <ChoiceButtonStyleStudioDialog
          command={command}
          choiceIndex={styleChoiceIndex}
          onApply={(style, scope) => applyButtonStyle(styleChoiceIndex, style, scope)}
          onClose={() => setStyleChoiceIndex(undefined)}
        />
      )}
    </div>
  );
}
