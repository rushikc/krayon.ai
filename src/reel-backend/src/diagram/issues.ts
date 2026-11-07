export type IssueSeverity = "error" | "warning";

export type IssueCode =
  | "SCHEMA_INVALID"
  | "DUPLICATE_ID"
  | "UNKNOWN_REF"
  | "EDGE_ENDPOINT_NOT_NODE"
  | "INVALID_STEP"
  | "STEPS_NOT_CONTIGUOUS"
  | "STEPS_NOT_INCREASING"
  | "TEXT_TOO_LONG"
  | "DENSITY"
  | "TEXT_TOO_SMALL"
  | "OVERLAP"
  | "OUT_OF_BOUNDS"
  | "TEXT_OVERFLOW"
  | "EDGE_CROSSES_NODE"
  | "STEP_NOT_ON_WORD"
  | "CHROME_NOT_FOUND"
  | "REEL_NOT_FOUND";

export type DiagramIssue = {
  code: IssueCode;
  severity: IssueSeverity;
  cardId?: string;
  step?: number;
  elementId?: string;
  message: string;
};

export function issue(
  code: IssueCode,
  severity: IssueSeverity,
  message: string,
  extra: Partial<Pick<DiagramIssue, "cardId" | "step" | "elementId">> = {},
): DiagramIssue {
  return { code, severity, message, ...extra };
}

export function hasError(issues: DiagramIssue[]): boolean {
  return issues.some((item) => item.severity === "error");
}
