/** Keep actionable diagnostics separate from the short status/toast summary. */
export class CartridgeValidationError extends Error {
  readonly issues: Array<{ code: string; message: string }>;

  constructor(issues: Array<{ code: string; message: string }>) {
    super(issues.map(issue => issue.message).join("\n"));
    this.name = "CartridgeValidationError";
    this.issues = issues.map(({ code, message }) => ({ code, message }));
  }
}
