// Only fixed stage names belong here: never pass paths, URLs or content keys.
export function logTiming(event) {
  if (process.env.MOLNOTES_TIMINGS === "1")
    console.error(JSON.stringify({ event: "stage_timing", ...event }));
}

export async function measureStage(stage, operation, report = logTiming) {
  const start = performance.now();
  let result = "failed";
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
