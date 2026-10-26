/** One entry of a section sidebar. */
export interface NavItem {
  /** Route path inside the application, such as `/` or `/chapters/3`. */
  to: string;
  label: string;
  number?: string;
  read?: boolean;
  bookmarked?: boolean;
  /** Wrong answers the reader still has on this entry. */
  mistakes?: number;
}

/** A labelled section of entries. */
export interface NavGroup {
  id?: string;
  label?: string;
  items: NavItem[];
  groups?: NavGroup[];
}

/** The entry for `path`: an exact match, else the entry whose path `path` lies under. */
export function currentItem(items: readonly NavItem[], path: string) {
  return (
    items.find((item) => item.to === path) ??
    items.find(
      (item) => !item.to.endsWith("/") && path.startsWith(`${item.to}/`),
    )
  );
}

export function flatItems(groups: readonly NavGroup[]): NavItem[] {
  return groups.flatMap((group) => [
    ...group.items,
    ...flatItems(group.groups ?? []),
  ]);
}

/** What a sidebar's groups read from the sidebar that holds them. */
export interface SidebarState {
  readonly current: NavItem | undefined;
  /** Whether the entry passes the reader's filter. */
  shows(item: NavItem): boolean;
  showsGroup(group: NavGroup): boolean;
  /** Closes the mobile drawer once the reader picks an entry. */
  picked(): void;
}

/** One notebook or topic on the fixed shelf. */
export interface ShelfItem {
  group?: string;
  href: string;
  label: string;
  current: boolean;
  progress: string;
  progressLabel: string;
}
