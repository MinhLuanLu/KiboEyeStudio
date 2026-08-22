/**
 * Studio-vs-device PIXEL parity: renders every authored pose twice — once through the studio's
 * real renderFace()/drawEye() on a Canvas 2D, once through the REAL exported eyes.h compiled and
 * executed on this machine — and diffs the two images.
 *
 * Run with:  npm run verify:device-parity -- "path/to/project.kiboeyes"
 *
 * Why this exists alongside verifyEyeGeometryParity.ts: that script re-implements both sides'
 * formulas in TypeScript and compares them to each other. Every divergence found in practice (eye
 * rotation left unbaked, eyelid tilt not baked, the Disable-Eyelid clip skipped by the bake) lived
 * in the gap between those hand-written models and the real code — so the model-vs-model check
 * passed while the device visibly disagreed with the preview. This one runs the actual code on
 * both sides, so there is no model left to drift.
 *
 * Requires g++ on PATH (msys2/mingw/WSL all work) and @napi-rs/canvas.
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFileSync } from 'child_process'
import { createCanvas } from '@napi-rs/canvas'
import { generateCppHeader, collectAnimationBreakpoints } from '../src/lib/export/cppExport'
import { sampleAnimationEye, sampleAnimationColors } from '../src/engine/interpolate'
import { renderFace } from '../src/renderer/faceRenderer'
import type { Project } from '../src/types'

const HERE = path.join(process.cwd(), 'scripts', 'deviceParity')
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'kibo-parity-'))

/**
 * A mismatched pixel is forgiven if it sits within this distance of an edge in the other image.
 * Canvas antialiases its edges; the device writes hard pixels. 1px absorbs exactly that and
 * nothing more — a real geometry bug displaces edges by far more than one pixel.
 */
const EDGE_TOLERANCE_PX = 1
/** Share of the display that may disagree before a pose is reported. 0.2% of 240x240 is ~115px. */
const FAIL_FRACTION = 0.002

const projectPath = process.argv[2]
if (!projectPath) {
  console.error('usage: npm run verify:device-parity -- <project.kiboeyes>')
  process.exit(1)
}
const rawFile = JSON.parse(fs.readFileSync(projectPath, 'utf-8'))
const project: Project = rawFile.project ?? rawFile
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

const W = project.display.width
const H = project.display.height

// ------------------------------------------------------------------ firmware side
console.log(`project: ${project.name}  (${W}x${H})`)
const header = generateCppHeader(clone(project), { bakeRotation: true, includeExpressions: true })
fs.writeFileSync(path.join(WORK, 'eyes_under_test.h'), header)

const animIdents = [...header.matchAll(/^const EyeAnimation Anim_(\w+) = \{/gm)].map((m) => m[1])
const countOf = (ident: string): number => {
  const m = header.match(new RegExp(`^const uint16_t Anim_${ident}_count = (\\d+);`, 'm'))
  return m ? parseInt(m[1], 10) : 0
}
if (animIdents.length !== project.animations.length) {
  console.error(
    `STRUCTURAL MISMATCH: header emitted ${animIdents.length} animations, project has ${project.animations.length}`
  )
  process.exit(1)
}

// One binary renders every frame of every animation. eyesLerpFrame(f, f, 0) turns a stored frame
// into the LiveEye the draw call wants, so no player or clock is involved and each pose is exact —
// this isolates geometry/appearance from timing, which is a separate concern with its own failure
// modes.
const table = animIdents.map((id) => `  &Anim_${id},`).join('\n')
const main = [
  '#include "host_gfx.h"',
  'unsigned long g_hostMillis = 0;',
  'HostSerial Serial;',
  '#include "eyes_under_test.h"',
  'static HostCanvas eyesFrame(EYE_DISPLAY_WIDTH, EYE_DISPLAY_HEIGHT);',
  'static const EyeAnimation* const ANIMS[] = {',
  table,
  '};',
  'int main(int argc, char** argv) {',
  '  int idx = 0;',
  '  for (unsigned a = 0; a < sizeof(ANIMS) / sizeof(ANIMS[0]); a++) {',
  '    const EyeAnimation* an = ANIMS[a];',
  '    const EyeFrame* rf = an->framesRight ? an->framesRight : an->frames;',
  '    for (int i = 0; i < an->count; i++) {',
  '      LiveEye L = eyesLerpFrame(an->frames[i], an->frames[i], 0.0f);',
  '      LiveEye R = eyesLerpFrame(rf[i], rf[i], 0.0f);',
  '      EyeColorSet cs = an->colors ? an->colors[i] : eyesPlayer.colorsLeft;',
  '      eyesFrame.fillScreen(EYE_COLOR_BACKGROUND);',
  '      eyesDrawEyePair(eyesFrame, EYE_DISPLAY_WIDTH / 2, EYE_DISPLAY_HEIGHT / 2, L, R,',
  '                      EYE_COLOR_BACKGROUND, cs, cs);',
  '      char p[1024];',
  '      snprintf(p, sizeof(p), "%s/f%d.ppm", argv[1], idx++);',
  '      eyesFrame.writePPM(p);',
  '    }',
  '  }',
  '  printf("%d\\n", idx);',
  '  return 0;',
  '}'
].join('\n')
fs.writeFileSync(path.join(WORK, 'main.cpp'), main)
fs.copyFileSync(path.join(HERE, 'host_gfx.h'), path.join(WORK, 'host_gfx.h'))

process.stdout.write('compiling exported firmware... ')
const exe = path.join(WORK, 'render.exe')
try {
  execFileSync('g++', ['-std=c++17', '-O1', '-I', WORK, '-o', exe, path.join(WORK, 'main.cpp')], { stdio: 'pipe' })
} catch (e: unknown) {
  const err = e as { stderr?: Buffer; message?: string }
  console.error('\nFAILED to compile the exported header:\n' + (err.stderr?.toString() ?? err.message))
  process.exit(1)
}
console.log('ok')
process.stdout.write('rendering device frames... ')
const rendered = parseInt(execFileSync(exe, [WORK.replace(/\\/g, '/')]).toString().trim(), 10)
console.log(`${rendered} frames`)

// ------------------------------------------------------------------ helpers
function readPPM(file: string): Uint8Array {
  const b = fs.readFileSync(file)
  let p = 0
  for (let k = 0; k < 3; k++) {
    while (b[p] !== 10) p++
    p++
  }
  return new Uint8Array(b.subarray(p))
}

const hexToRgb = (h: string): [number, number, number] => {
  const v = parseInt(h.replace('#', ''), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/**
 * "Ink" = anything that is not the background colour. Both sides quantise to RGB565 here
 * (firmwareSim on the studio side), so the threshold only has to survive rounding.
 */
function inkMask(rgb: Uint8Array, bg: [number, number, number]): Uint8Array {
  const m = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    const d =
      Math.abs(rgb[i * 3] - bg[0]) + Math.abs(rgb[i * 3 + 1] - bg[1]) + Math.abs(rgb[i * 3 + 2] - bg[2])
    m[i] = d > 24 ? 1 : 0
  }
  return m
}

function dilate(m: Uint8Array, r: number): Uint8Array {
  let cur = m
  for (let pass = 0; pass < r; pass++) {
    const out = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (cur[y * W + x]) {
          out[y * W + x] = 1
          continue
        }
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx >= 0 && ny >= 0 && nx < W && ny < H && cur[ny * W + nx]) out[y * W + x] = 1
          }
        }
      }
    }
    cur = out
  }
  return cur
}

/** Pixels in `a` with no counterpart within EDGE_TOLERANCE_PX in `b`, and vice versa. */
function disagreement(a: Uint8Array, b: Uint8Array): number {
  const ad = dilate(a, EDGE_TOLERANCE_PX)
  const bd = dilate(b, EDGE_TOLERANCE_PX)
  let n = 0
  for (let i = 0; i < W * H; i++) {
    if (a[i] && !bd[i]) n++
    else if (b[i] && !ad[i]) n++
  }
  return n
}

// ------------------------------------------------------------------ studio side + diff
const canvas = createCanvas(W, H)
const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
const colors = project.colors as unknown as Record<string, string>
const bg = hexToRgb(colors.background ?? '#000000')
const display = project.display as unknown as Record<string, never> & { shape?: string; cornerRadius?: number }

interface Row {
  name: string
  frame: number
  bad: number
  pct: number
}
const rows: Row[] = []
let skipped = 0
let idx = 0

for (let a = 0; a < project.animations.length; a++) {
  const anim = project.animations[a]
  // The export does NOT emit one frame per keyframe: it merges the breakpoints of every track
  // (main / left / right / pupil / eyelid) and samples the animation at each. Reading raw
  // keyframes here would compare mismatched pairs -- which is why several animations came out one
  // frame short. Use the export's own breakpoint list and the studio's own sampler, so both sides
  // are driven by the same engine rather than by a re-derivation of it.
  const times = collectAnimationBreakpoints(anim)
  const emitted = countOf(animIdents[a])
  if (emitted !== times.length) {
    console.warn(
      `  ! "${anim.name}": header has ${emitted} frames, breakpoints give ${times.length} — skipped`
    )
    skipped += emitted
    idx += emitted
    continue
  }
  for (let i = 0; i < emitted; i++, idx++) {
    const t = times[i]
    const left = sampleAnimationEye(anim, t, 'left')
    const right = sampleAnimationEye(anim, t, 'right')
    // Per-keyframe colour overrides are real and drastic here (one project flips the border from
    // #000000 to #ffffff mid-animation), and the firmware honours them via Anim_X_colors[i]. Using
    // the project base palette for every frame would report those as geometry failures.
    const frameColors = sampleAnimationColors(anim, t, project.colors)
    ctx.clearRect(0, 0, W, H)
    renderFace(ctx, left, {
      width: W,
      height: H,
      shape: (display.shape ?? 'circle') as never,
      cornerRadius: display.cornerRadius ?? 0,
      backgroundColor: colors.background ?? '#000000',
      showBezel: false,
      theme: frameColors as never,
      rightParams: right,
      rightTheme: frameColors as never,
      customShapes: project.customPupilShapes ?? [],
      customEyeShapes: project.customEyeShapes ?? [],
      firmwareSim: true
    })
    const img = ctx.getImageData(0, 0, W, H).data
    const studio = new Uint8Array(W * H * 3)
    for (let k = 0; k < W * H; k++) {
      studio[k * 3] = img[k * 4]
      studio[k * 3 + 1] = img[k * 4 + 1]
      studio[k * 3 + 2] = img[k * 4 + 2]
    }
    const device = readPPM(path.join(WORK, `f${idx}.ppm`))
    const bad = disagreement(inkMask(studio, bg), inkMask(device, bg))
    rows.push({ name: anim.name, frame: i, bad, pct: (100 * bad) / (W * H) })
  }
}

rows.sort((x, y) => y.pct - x.pct)
const failing = rows.filter((r) => r.pct > FAIL_FRACTION * 100)
const mean = rows.reduce((s, r) => s + r.pct, 0) / Math.max(1, rows.length)

console.log(`\nposes compared   : ${rows.length}${skipped ? ` (${skipped} skipped)` : ''}`)
console.log(`mean disagreement: ${mean.toFixed(4)} %`)
console.log('worst 8:')
for (const r of rows.slice(0, 8)) {
  console.log(`   ${r.pct.toFixed(3).padStart(7)} %  ${String(r.bad).padStart(5)} px   "${r.name}" frame ${r.frame}`)
}
console.log(`\n${failing.length} pose(s) over the ${(FAIL_FRACTION * 100).toFixed(2)} % threshold`)

fs.rmSync(WORK, { recursive: true, force: true })
process.exit(failing.length > 0 ? 1 : 0)
