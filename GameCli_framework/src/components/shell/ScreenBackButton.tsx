import { ArrowLeft } from "lucide-react";
import { Button } from "../common/Button";

export function ScreenBackButton({
  testId,
  label = "返回",
  onClick,
}: {
  testId: string;
  label?: string;
  onClick: () => void;
}) {
  return (
    <Button className="screen-back-button" variant="ghost" data-testid={testId} onClick={onClick}>
      <ArrowLeft size={17} aria-hidden="true" />
      <span>{label}</span>
    </Button>
  );
}
