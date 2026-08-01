import { HelpCircle } from "lucide-react";
import { translateField } from "../../utils/fieldTranslations";

interface FieldHelpProps {
  field: string;
}

export function FieldHelp({ field }: FieldHelpProps) {
  const label = translateField(field);
  return (
    <span className="field-help" title={label} aria-label={label} data-field={field} data-help-key={`field.${field}`}>
      <HelpCircle size={14} />
    </span>
  );
}
