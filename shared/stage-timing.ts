// Only fixed stage names belong here: never pass paths, URLs or content keys.
export interface StageTiming {
  stage: string;
  result: "success" | "failed";
  durationMs: number;
}

export function logTiming(event: StageTiming) {
  if (process.env.MOLNOTES_TIMINGS === "1")
    console.error(JSON.stringify({ event: "stage_timing", ...event }));
}

export async function measureStage<T>(
  stage: string,
  operation: () => Promise<T> | T,
  report: (event: StageTiming) => void = logTiming,
): Promise<T> {
  const start = performance.now();
  let result: StageTiming["result"] = "failed";
  try {
    const value = await operation();
    result = "success";
    return value;
  } finally {
    report({
      stage,
      result,
      durationMs: Math.round((performance.now() - start) * 100) / 100,
    });
  }
}
