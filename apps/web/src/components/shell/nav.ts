import {
  LayoutDashboard,
  FolderKanban,
  FilePlus2,
  LibraryBig,
  Clapperboard,
  NotebookPen,
  PanelsTopLeft,
  Shapes,
  PackageCheck,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  shortcut?: string;
  children?: { label: string; href: string }[];
}

export const NAV: NavItem[] = [
  { label: "Overview", href: "/app", icon: LayoutDashboard, shortcut: "G O" },
  { label: "Projects", href: "/app/projects", icon: FolderKanban, shortcut: "G P" },
  { label: "Create Magazine", href: "/app/new", icon: FilePlus2, shortcut: "C" },
  { label: "Reference Library", href: "/app/references", icon: LibraryBig, shortcut: "G R" },
  { label: "Event Media Library", href: "/app/media", icon: Clapperboard, shortcut: "G M" },
  { label: "Content Studio", href: "/app/studio", icon: NotebookPen, shortcut: "G S" },
  {
    label: "Magazine Designer",
    href: "/app/designer",
    icon: PanelsTopLeft,
    shortcut: "G D",
    children: [
      { label: "Flatplan", href: "/app/designer" },
      { label: "Page editor", href: "/app/designer/editor" },
      { label: "Preflight", href: "/app/designer/preflight" },
    ],
  },
  { label: "Templates", href: "/app/templates", icon: Shapes, shortcut: "G T" },
  { label: "Exports", href: "/app/exports", icon: PackageCheck, shortcut: "G E" },
  { label: "Settings", href: "/app/settings", icon: Settings },
];

/** Labels for breadcrumb segments. */
export const SEGMENT_LABELS: Record<string, string> = {
  app: "Workspace",
  projects: "Projects",
  new: "Create Magazine",
  references: "Reference Library",
  media: "Event Media Library",
  studio: "Content Studio",
  designer: "Magazine Designer",
  editor: "Page editor",
  preflight: "Preflight",
  templates: "Templates",
  exports: "Exports",
  settings: "Settings",
  integrations: "Integrations",
};
