export type ThreadWorkflowActionKind =
  | "commit"
  | "create_pull_request"
  | "merge_pull_request";

export interface ThreadWorkflowAction {
  disabled?: boolean;
  kind?: ThreadWorkflowActionKind;
  label: string;
  onSelect: () => void;
  tooltip?: string;
}
