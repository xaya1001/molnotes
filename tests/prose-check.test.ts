import assert from "node:assert/strict";
import test from "node:test";
import { strings } from "../scripts/prose-check.ts";

test("citation pointers are not counted as prose", () => {
  const out = strings(
    {
      lead: "这是一句需要检查的中文正文，长度超过二十个字符以便被收集。",
      locator: "必读 · EPUB 22.4，图 22-51 与相邻正文，页码与图号都在这里",
      file: "materials/textbooks/biology/一本书的很长的文件名称加上中文名称.pdf",
    },
    [],
  );
  assert.equal(out.length, 1);
  assert.match(out[0].text, /需要检查/);
});
