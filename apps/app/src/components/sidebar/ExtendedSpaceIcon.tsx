import type { SpaceIcon } from "@bb/domain";

const EXTENDED_SPACE_ICONS: Partial<Record<SpaceIcon, string>> = {
  app: "🪟",
  archive: "🗄️",
  beaker: "🧪",
  brain: "🧠",
  browser: "🌐",
  bug: "🐛",
  calendar: "📅",
  chart: "📊",
  cloud: "☁️",
  code: "⌨️",
  terminal: "▣",
  discord: "👾",
  document: "📄",
  eye: "👁️",
  file: "🗒️",
  folderOpen: "📂",
  fork: "⑂",
  branch: "⑃",
  merge: "⑂",
  globe: "🌎",
  laptop: "💻",
  list: "☷",
  todo: "☑️",
  lock: "🔒",
  mail: "✉️",
  message: "💬",
  mic: "🎙️",
  package: "📦",
  palette: "🎨",
  pin: "📌",
  play: "▶️",
  puzzle: "🧩",
  repeat: "🔁",
  search: "🔎",
  settings: "⚙️",
  smartphone: "📱",
  square: "◼️",
  toolbox: "🧰",
  user: "👤",
};

export default function ExtendedSpaceIcon({ icon }: { icon: SpaceIcon }) {
  const glyph = EXTENDED_SPACE_ICONS[icon];
  if (!glyph) return null;

  return (
    <span aria-hidden="true" className="text-base leading-none">
      {glyph}
    </span>
  );
}
