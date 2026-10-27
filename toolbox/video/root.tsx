import { Composition } from "remotion";
import { ProximityDemo } from "./scene.tsx";

export const VideoRoot = () => (
  <Composition
    id="ProximityDemo"
    component={ProximityDemo}
    durationInFrames={150}
    fps={30}
    width={960}
    height={540}
  />
);
