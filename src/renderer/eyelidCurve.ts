// Shared eyelid taper law — the ONE definition of "how tall is this eyelid's curve at horizontal
// position u" used by both the studio preview (drawEye.ts) and the ESP32 export (cppExport.ts's
// hand-ported `eyesEyelidTaper()`, kept numerically identical on purpose). Replaces the older
// single-plateau-at-center design: this version anchors each SIDE's own edge height (roundness)
// independently and blends toward a repositionable center height (centerDepth/centerX), which is
// what lets one eyelid read as "tall outer corner, soft valley toward the shared center" instead
// of always peaking at its own midpoint.
//
// Returned value is a 0..1 "height fraction" — the caller multiplies by its own curveOffset
// (curvature% * eye height * 0.5 * stretchY) to get the actual pixel offset, exactly like before.

export interface EyelidCurveShape {
  /** 0-100: height (as a fraction of the curve's own amplitude) at this eye's own left edge
   * (u=-1) — 0 = flat/flush with the eye's flat side there, 100 = the curve reaches its full
   * amplitude right at that edge ("tall, fully rounded corner"). */
  leftRoundness: number
  /** 0-100: same as leftRoundness, for this eye's own right edge (u=+1). */
  rightRoundness: number
  /** 0-100: how much of each side's span (from its own edge to the center point) is spent in
   * the smooth transition vs. sitting flat at that edge's own height. 100 (the default, matching
   * every pre-existing saved project's `upperEyelidStretchX: 100`) means the transition runs the
   * *entire* span with no flat shoulder — reproducing the old formula's single continuous curve.
   * Lower values leave more of each side flat at its own edge height before curving toward the
   * center, narrowing the visible "bump" — the same directionality the old stretchX/"compress"
   * knob had. */
  width: number
  /** 0-100: how deep the center point dips below the edges' own height — 0 = the center sits at
   * full height (a flat-topped dome when both edges are also tall), 100 = the center point drops
   * all the way down to the curve's own baseline (a full valley). */
  centerDepth: number
  /** -100..100: shifts the center point (and therefore the peak/valley) left/right — this eye's
   * own left/right, not sign-mirrored (same convention `skew` already used). Reused directly as
   * the UI's "Center Position X". */
  centerX: number
  /** 0-100: blends the transition's ease between a cubic (smoothstep) and quintic (smootherstep)
   * S-curve — both are individually zero-slope at both ends, so this never risks a kink, it only
   * changes how gradually the curve leaves each flat shoulder. */
  smoothness: number
  /** 0-100: biases the transition to linger closer to the edge height before rushing toward the
   * center height, via a power curve on the eased fraction — the power function preserves the
   * eased curve's zero slope at both ends for any exponent >= 1, so this is safe at any value. */
  tension: number
}

function clamp01Pct(v: number): number {
  return Math.min(100, Math.max(0, v)) / 100
}

function clampPmPct(v: number): number {
  return Math.min(100, Math.max(-100, v)) / 100
}

// f(0)=0, f(1)=1, f'(0)=f'(1)=0.
function smoothstep(s: number): number {
  return s * s * (3 - 2 * s)
}

// f(0)=0, f(1)=1, f'(0)=f'(1)=0 AND f''(0)=f''(1)=0 (one degree smoother than smoothstep).
function smootherstep(s: number): number {
  return s * s * s * (s * (s * 6 - 15) + 10)
}

/**
 * Height fraction (0..1) of the eyelid curve at normalized horizontal position `u` (-1 = this
 * eye's own left edge, +1 = this eye's own right edge). Provably C1-continuous everywhere: each
 * half of the curve is a flat run (zero slope, at that side's own edge height) followed by an
 * eased transition built from smoothstep/smootherstep (each individually zero-slope at BOTH of
 * its own ends) raised to a tension-driven power (which preserves zero-slope endpoints for any
 * exponent >= 1) — so the flat-to-transition join on each side, AND the point where the two
 * sides' transitions meet at the (possibly off-center) center point, both have matching (zero)
 * derivatives by construction, for every parameter combination. No iteration, no lookup table —
 * a closed-form expression, so the exact same formula ports verbatim to C++ (see
 * `eyesEyelidTaper()` in cppExport.ts) with no risk of studio/firmware drift.
 */
export function eyelidTaper(u: number, shape: EyelidCurveShape): number {
  const leftH = clamp01Pct(shape.leftRoundness)
  const rightH = clamp01Pct(shape.rightRoundness)
  const centerH = 1 - clamp01Pct(shape.centerDepth)
  // Kept away from the true edges (+-1) so both sides always retain a real, nonzero span.
  const cx = clampPmPct(shape.centerX) * 0.9
  // How much of each side's own span stays flat at edge height before the transition begins —
  // capped below 1 so the transition zone can never shrink to exactly zero width (which would
  // otherwise be a real, literal jump whenever edge height != center height).
  const flatFrac = Math.min(0.85, Math.max(0, 1 - clamp01Pct(shape.width)))
  const smooth = clamp01Pct(shape.smoothness)
  const tension = clamp01Pct(shape.tension)

  const uc = Math.min(1, Math.max(-1, u))
  const onLeft = uc <= cx
  const edgeU = onLeft ? -1 : 1
  const edgeH = onLeft ? leftH : rightH
  const shoulder = edgeU + (cx - edgeU) * flatFrac
  const pastShoulder = onLeft ? uc > shoulder : uc < shoulder
  if (!pastShoulder) return edgeH

  const shoulderSpan = Math.max(0.0001, Math.abs(cx - shoulder))
  const s = Math.min(1, Math.max(0, Math.abs(uc - shoulder) / shoulderSpan))
  const eased = smoothstep(s) * (1 - smooth) + smootherstep(s) * smooth
  const shaped = Math.pow(eased, 1 + tension * 2)
  return edgeH + (centerH - edgeH) * shaped
}
