/** Where the reader stopped in a note on this device: scroll offset and the section heading in view. */
export interface ReadingPosition {
  scroll: number;
  section: string;
}

export function readPosition(path: string): ReadingPosition {
  try {
    const scroll = Number(localStorage.getItem(`notes/scroll:${path}`) || 0);
    return {
      scroll: Number.isFinite(scroll) && scroll >= 0 ? scroll : 0,
      section: localStorage.getItem(`notes/section:${path}`) ?? "",
    };
  } catch {
    return { scroll: 0, section: "" };
  }
}

export function savePosition(path: string, position: ReadingPosition) {
  try {
    localStorage.setItem(`notes/scroll:${path}`, String(position.scroll));
    localStorage.setItem(`notes/section:${path}`, position.section);
  } catch {
    /* Device position is optional. */
  }
}
