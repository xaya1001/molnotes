import MarkdownIt from "markdown-it";
import markdownItCjkFriendly from "markdown-it-cjk-friendly";

export function proseMarkdown() {
  const md = new MarkdownIt("commonmark", { html: false }).use(
    markdownItCjkFriendly,
  );
  md.inline.ruler.before("escape", "term-math", (state, silent) => {
    const remaining = state.src.slice(state.pos, state.posMax);
    const term = /^\[\[([^\]\n]+)\]\]/.exec(remaining);
    const math = /^\$([^$\n]+)\$/.exec(remaining);
    const match = term ?? math;
    if (!match) return false;
    if (!silent) {
      const token = state.push(term ? "note_term" : "note_math", "", 0);
      token.content = match[1];
      token.markup = term ? "[[" : "$";
    }
    state.pos += match[0].length;
    return true;
  });
  md.inline.ruler.before("escape", "chemical-name", (state, silent) => {
    if (state.src[state.pos] !== "{") return false;
    const match = /^\{(?:\\[^\n]|[^{}\\\n])+\}/.exec(
      state.src.slice(state.pos, state.posMax),
    );
    if (!match) return false;
    const end = state.pos + match[0].length;
    if (!silent) {
      const limit = state.posMax;
      const open = state.push("chemical_name_open", "span", 1);
      open.attrSet("class", "chemical-name");
      state.pos++;
      state.posMax = end - 1;
      md.inline.tokenize(state);
      state.posMax = limit;
      state.push("chemical_name_close", "span", -1);
    }
    state.pos = end;
    return true;
  });
  return md;
}
