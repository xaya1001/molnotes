import { Composition } from "remotion";
import { ProximityDemo } from "./scene";

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
