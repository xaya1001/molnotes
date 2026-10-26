import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

export const ProximityDemo = () => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [28, 105], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const x = 220 + progress * 245;
  const caption =
    frame < 28
      ? "先辨认两个对象"
      : frame < 105
        ? "让对象 A 接近对象 B"
        : "观察相邻后的几何关系";

  return (
    <AbsoluteFill
      style={{
        background: "#f4f8f6",
        color: "#17393a",
        fontFamily: "Arial, sans-serif",
        padding: 48,
      }}
    >
      <div style={{ fontSize: 24, letterSpacing: 3, color: "#247c82" }}>
        INTERACTIVE LEARNING · CODE-GENERATED EXPLAINER
      </div>
      <div style={{ fontSize: 48, fontWeight: 700, marginTop: 18 }}>
        分步讲解动画示例
      </div>
      <svg viewBox="0 0 864 280" style={{ width: "100%", marginTop: 24 }}>
        <rect width="864" height="280" rx="28" fill="#e5f0ed" />
        <line
          x1={x + 54}
          y1="140"
          x2="576"
          y2="140"
          stroke="#769a94"
          strokeDasharray="10 10"
          strokeWidth="4"
        />
        <circle cx={x} cy="140" r="54" fill="#247c82" />
        <circle cx="630" cy="140" r="54" fill="#c58c45" />
        <text x={x} y="155" textAnchor="middle" fill="white" fontSize="42">
          A
        </text>
        <text x="630" y="155" textAnchor="middle" fill="white" fontSize="42">
          B
        </text>
      </svg>
      <div style={{ fontSize: 34, fontWeight: 600, marginTop: 15 }}>
        {caption}
      </div>
      <div style={{ fontSize: 20, color: "#52716f", marginTop: 9 }}>
        中性示例 · 距离变化不代表真实分子相互作用
      </div>
    </AbsoluteFill>
  );
};
