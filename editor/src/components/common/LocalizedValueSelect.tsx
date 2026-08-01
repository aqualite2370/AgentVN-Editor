import { useEffect, useState } from "react";
import { RichSelect, type RichSelectOption } from "./RichSelect";

export interface LocalizedOption<T extends string = string> {
  value: T;
  label: string;
}

const customValue = "__custom__";

export function LocalizedValueSelect<T extends string>({
  value,
  options,
  emptyLabel,
  customLabel = "自定义",
  customPlaceholder = "填写自定义内部值",
  disabled,
  helpKey,
  onChange,
}: {
  value?: T | "" | null;
  options: ReadonlyArray<LocalizedOption<T>>;
  emptyLabel?: string;
  customLabel?: string;
  customPlaceholder?: string;
  disabled?: boolean;
  helpKey?: string;
  onChange: (value: T | "") => void;
}) {
  const [editingCustom, setEditingCustom] = useState(false);
  const normalizedValue = (value ?? "") as T | "";
  const knownValues = new Set(options.map((option) => option.value));
  const isEmpty = normalizedValue === "";
  const isKnown = isEmpty || knownValues.has(normalizedValue as T);
  const selectValue = editingCustom || !isKnown ? customValue : normalizedValue;
  const selectOptions: Array<RichSelectOption<T | "" | typeof customValue>> = [
    ...(emptyLabel !== undefined ? [{ value: "" as const, label: emptyLabel }] : []),
    ...options.map((option) => ({ value: option.value, label: option.label })),
    { value: customValue, label: customLabel },
  ];

  useEffect(() => {
    if (!isKnown) setEditingCustom(true);
  }, [isKnown]);

  return (
    <div className="localized-value-select">
      <RichSelect
        disabled={disabled}
        value={selectValue}
        options={selectOptions}
        helpKey={helpKey}
        variant="compact"
        onChange={(nextValue) => {
          if (nextValue === customValue) {
            setEditingCustom(true);
            return;
          }
          setEditingCustom(false);
          onChange(nextValue as T | "");
        }}
      />
      {(editingCustom || !isKnown) && (
        <input
          disabled={disabled}
          value={normalizedValue}
          placeholder={customPlaceholder}
          data-help-key={helpKey}
          onChange={(event) => onChange(event.target.value as T | "")}
        />
      )}
    </div>
  );
}
