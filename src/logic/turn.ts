/** Every side of the object that can be turned to face +Z. */
export const TURN_FACES = ["+x", "-x", "+y", "-y", "+z", "-z"] as const;
export type TurnFace = (typeof TURN_FACES)[number];

export type TurnAxis = "x" | "y" | "z";

/**
 * Yaw/pitch that maps `face` onto +Z.
 * Yaw -90 sends +X to +Z. Pitch +90 sends +Y to +Z.
 */
export function yawPitchForFace(face: TurnFace): { yaw: number; pitch: number } {
  switch (face) {
    case "+z":
      return { yaw: 0, pitch: 0 };
    case "-z":
      return { yaw: 180, pitch: 0 };
    case "+x":
      return { yaw: -90, pitch: 0 };
    case "-x":
      return { yaw: 90, pitch: 0 };
    case "+y":
      return { yaw: 0, pitch: 90 };
    case "-y":
      return { yaw: 0, pitch: -90 };
  }
}
