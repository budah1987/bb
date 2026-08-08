import { CHROME_SECTION_LABEL_CLASS } from "@/components/ui/chromeStyleTokens";

/**
 * The rail is secondary chrome: information you glance at, not content you
 * read. Everything inside it is quiet by default, and these tokens are what
 * keep it that way as sections are added.
 *
 * The ladder, dimmest last:
 *   row label      → RAIL_ROW_CLASS      (text-xs, muted-foreground)
 *   prose          → RAIL_PROSE_CLASS    (text-xs, muted-foreground)
 *   section label  → RAIL_LABEL_CLASS    (chrome label, subtle-foreground/75)
 *   dimmed prose   → RAIL_PROSE_DIM_CLASS
 *
 * bb's 10px chrome tier (`text-2xs`) is not used here: theme.css forbids
 * pairing it with anything below `--subtle-foreground`, which is exactly the
 * tier a rail label wants. So the size difference between label and row is
 * carried by weight and color rather than by an off-scale font size.
 */
export const RAIL_LABEL_CLASS = CHROME_SECTION_LABEL_CLASS;

/** Body text inside the rail — rows, prose, the scratchpad. */
export const RAIL_BODY_TEXT_CLASS = "text-xs font-normal leading-5";

/**
 * Prose that the rail merely reports (a recap). Quieter than the app's content
 * foreground, still above the label tier so it stays readable at 12px.
 */
export const RAIL_PROSE_CLASS = `${RAIL_BODY_TEXT_CLASS} text-muted-foreground`;

/**
 * The same prose when it can no longer be trusted as current. Drops to the
 * label tier — present, plainly de-emphasized, never presented as fresh.
 */
export const RAIL_PROSE_DIM_CLASS = `${RAIL_BODY_TEXT_CLASS} text-subtle-foreground/75`;

/**
 * Placeholder text is the quietest thing in the card. It is a prompt to act,
 * not content, and it vanishes the moment it has done its job — so it sits
 * below even the label tier and leans italic to read as an aside rather than as
 * text someone wrote. Overrides the shared control default
 * (`placeholder:text-muted-foreground`), which is the *recap prose* tier and so
 * renders brighter than every label around it.
 */
export const RAIL_PLACEHOLDER_CLASS =
  "placeholder:italic placeholder:text-subtle-foreground/55";

/**
 * Every interactive rail element shares one shape: a full-width, `rounded-lg`
 * target with `px-2 py-1` and a raised hover fill. Section headers and rows are
 * the same grammar at different emphases.
 */
export const RAIL_INTERACTIVE_CLASS =
  "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left outline-none hover:bg-state-hover focus-visible:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring";

/** Body inset for a section, sized so content lines up under its header label. */
export const RAIL_SECTION_BODY_CLASS = "px-2 pb-1";

/** Hairline rule between sections. Always owned by the *following* section. */
export const RAIL_DIVIDER_CLASS = "my-1 border-t border-border-hairline";

/**
 * Applied to a stack of {@link RailSection}s: each section carries its own
 * leading divider, and the stack hides the leading one. Sections can therefore
 * appear and disappear in any combination without ever leaving a doubled rule
 * or a rule dangling above nothing.
 */
export const RAIL_SECTION_STACK_CLASS =
  "flex min-w-0 flex-col [&>section:first-child>*:first-child]:hidden";
