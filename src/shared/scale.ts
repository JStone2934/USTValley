/** Physical dimensions are design defaults, not measured campus/student data. */
export type HumanDimensions = {
  heightMeters: number;
  widthMeters: number;
  depthMeters: number;
  collisionRadiusMeters: number;
  walkingMetersPerSecond: number;
  runningMetersPerSecond: number;
  interactionMeters: number;
};
export type MetricScale = {
  referenceLatitudeDegrees: number;
  metersPerProjectedUnit: number;
  pixelsPerProjectedUnit: number;
  pixelsPerMeter: number;
  heightProjection: number;
};
export type ScenePlayer = {
  width: number;
  height: number;
  groundDepth: number;
  radius: number;
  speed: number;
  runSpeed: number;
  interactionRadius: number;
};

/** Local spherical Web Mercator ground scale; projection coordinates are not ground metres. */
export function metricScale(
  referenceNorthing: number,
  pixelsPerProjectedUnit: number,
  heightProjection: number,
): MetricScale {
  if (
    ![referenceNorthing, pixelsPerProjectedUnit, heightProjection].every(
      Number.isFinite,
    ) ||
    pixelsPerProjectedUnit <= 0 ||
    heightProjection <= 0
  )
    throw new Error("Invalid map scale");
  const latitude = Math.atan(Math.sinh(referenceNorthing / 6378137));
  const metersPerProjectedUnit = Math.cos(latitude);
  return {
    referenceLatitudeDegrees: (latitude * 180) / Math.PI,
    metersPerProjectedUnit,
    pixelsPerProjectedUnit,
    pixelsPerMeter: pixelsPerProjectedUnit / metersPerProjectedUnit,
    heightProjection,
  };
}

/** The same projection as the buildings: ground depth plus projected upright height. */
export function scenePlayer(
  scale: MetricScale,
  human: HumanDimensions,
): ScenePlayer {
  if (Object.values(human).some((n) => !Number.isFinite(n) || n <= 0))
    throw new Error("Invalid human dimensions");
  const ppm = scale.pixelsPerMeter;
  return {
    width: human.widthMeters * ppm,
    height:
      (human.heightMeters * scale.heightProjection + human.depthMeters) * ppm,
    groundDepth: human.depthMeters * ppm,
    radius: human.collisionRadiusMeters * ppm,
    speed: human.walkingMetersPerSecond * ppm,
    runSpeed: human.runningMetersPerSecond * ppm,
    interactionRadius: human.interactionMeters * ppm,
  };
}
