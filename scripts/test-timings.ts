import { readFile } from "node:fs/promises";
const report = JSON.parse(await readFile(process.argv[2], "utf8"));
// Playwright's JSON report; only the fields below are read.
interface ReportSuite {
  title: string;
  specs?: {
    title: string;
    tests: { status: string; results: { duration: number }[] }[];
  }[];
  suites?: ReportSuite[];
}
const rows: {
  title: string;
  duration: number;
  attempts: number;
  status: string;
}[] = [];
function visit(suite: ReportSuite, parents: string[] = []) {
  const titles = [...parents, suite.title].filter(Boolean);
  for (const spec of suite.specs ?? [])
    for (const test of spec.tests)
      rows.push({
        title: [...titles, spec.title].join(" › "),
        duration: test.results.reduce(
          (sum, result) => sum + result.duration,
          0,
        ),
        attempts: test.results.length,
        status: test.status,
      });
  for (const child of suite.suites ?? []) visit(child, titles);
}
for (const suite of report.suites) visit(suite);
console.log(
  "### Browser test timings\n\n| Test | Total seconds | Attempts | Status |\n| --- | ---: | ---: | --- |",
);
for (const row of rows.sort((a, b) => b.duration - a.duration).slice(0, 15))
  console.log(
    `| ${row.title.replaceAll("|", "\\|")} | ${(row.duration / 1000).toFixed(1)} | ${row.attempts} | ${row.status} |`,
  );
