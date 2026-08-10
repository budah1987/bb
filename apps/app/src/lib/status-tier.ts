/**
 * How loud a plain-text status label should read. The rail and its panels have
 * no dots and no badges, so tier is carried entirely by text color — which
 * makes it worth naming once rather than open-coding class names per row.
 */
export type StatusTier = "destructive" | "warning" | "success" | "muted";

export function statusTierClassName(tier: StatusTier): string {
  switch (tier) {
    case "destructive":
      return "text-destructive";
    case "warning":
      return "text-warning-text";
    case "success":
      return "text-success";
    case "muted":
      return "text-muted-foreground";
  }
}
