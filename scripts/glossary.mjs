// The site-wide glossary (glossary.json in the content directory). Notes
// write `[[term]]` and topic chapters list the terms they use; both resolve
// against this one list when content is published.

const fields = ["term", "full", "definition", "confusion"];
const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Throws on the first invalid entry; returns the entries unchanged. */
export function validateGlossary(glossary, name = "glossary.json") {
  if (!Array.isArray(glossary))
    throw new Error(`${name}: expected an array of terms`);
  const names = new Set();
  glossary.forEach((entry, index) => {
    const where = `${name}: [${index}]`;
    if (!isObject(entry)) throw new Error(`${where} must be an object`);
    for (const key of Object.keys(entry))
      if (!fields.includes(key)) throw new Error(`${where}: unknown ${key}`);
    for (const key of fields)
      if (typeof entry[key] !== "string" || !entry[key].trim())
        throw new Error(`${where}: ${key} must be text`);
    // A note writes the name inside [[...]], so it cannot hold "]" or a line break.
    if (entry.term !== entry.term.trim() || /[\]\n]/.test(entry.term))
      throw new Error(
        `${where}: invalid term name ${JSON.stringify(entry.term)}`,
      );
    if (names.has(entry.term))
      throw new Error(`${where}: duplicate term ${entry.term}`);
    names.add(entry.term);
  });
  return glossary;
}
