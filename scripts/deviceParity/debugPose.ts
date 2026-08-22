/**
 * Dumps one pose rendered both ways, side by side, as a PNG — for when the parity run reports a
 * disagreement and you need to see WHAT differs rather than how much.
 *
 *   npx tsx --tsconfig tsconfig.web.json scripts/deviceParity/debugPose.ts <project> <animName> <frameIdx> <out.png>
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFileSync } from 'child_process'
import { createCanvas } from '@napi-rs/canvas'
import { generateCppHeader, collectAnimationBreakpoints } from '../../src/lib/export/cppExport'
import { sampleAnimationEye, sampleAnimationColors } from '../../src/engine/interpolate'
import { renderFace } from '../../src/renderer/faceRenderer'
import type { Project } from '../../src/types'

const [projectPath, animName, frameArg, outPath] = process.argv.slice(2)
const frameIdx = parseInt(frameArg, 10)
const rawFile = JSON.parse(fs.readFileSync(projectPath, 'utf-8'))
const project: Project = rawFile.project ?? rawFile
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const W = project.display.width
const H = project.display.height

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'kibo-dbg-'))
const header = generateCppHeader(clone(project), { bakeRotation: true, includeExpressions: true })
fs.writeFileSync(path.join(WORK, 'eyes_under_test.h'), header)
fs.copyFileSync(path.join(process.cwd(), 'scripts', 'deviceParity', 'host_gfx.h'), path.join(WORK, 'host_gfx.h'))

const animIdents = [...header.matchAll(/^const EyeAnimation Anim_(\w+) = \{/gm)].map((m) => m[1])
const animIndex = project.animations.findIndex((a) => a.name === animName)
if (animIndex < 0) {
  console.error(`no animation named "${animName}"`)
  process.exit(1)
}
const ident = animIdents[animIndex]

const main = [
  '#include "host_gfx.h"',
  'unsigned long g_hostMillis = 0;',
  'HostSerial Serial;',
  '#include "eyes_under_test.h"',
  'static HostCanvas eyesFrame(EYE_DISPLAY_WIDTH, EYE_DISPLAY_HEIGHT);',
  'int main(int argc, char** argv) {',
  `  const EyeAnimation* an = &Anim_${ident};`,
  `  int i = ${frameIdx};`,
  '  const EyeFrame* rf = an->framesRight ? an->framesRight : an->frames;',
  '  LiveEye L = eyesLerpFrame(an->frames[i], an->frames[i], 0.0f);',
  '  LiveEye R = eyesLerpFrame(rf[i], rf[i], 0.0f);',
  '  EyeColorSet cs = an->colors ? an->colors[i] : eyesPlayer.colorsLeft;',
  '  eyesFrame.fillScreen(EYE_COLOR_BACKGROUND);',
  '  eyesDrawEyePair(eyesFrame, EYE_DISPLAY_WIDTH / 2, EYE_DISPLAY_HEIGHT / 2, L, R,',
  '                  EYE_COLOR_BACKGROUND, cs, cs);',
  '  eyesFrame.writePPM(argv[1]);',
  '  printf("w=%.1f h=%.1f rot=%.1f dist=%.1f posX=%.1f posY=%.1f upLid=%.1f upTilt=%.1f\\n",',
  '         L.width, L.height, L.rotation, L.distance, L.eyePosX, L.eyePosY, L.upperEyelid, L.upperEyelidTilt);',
  '  return 0;',
  '}'
].join('\n')
fs.writeFileSync(path.join(WORK, 'main.cpp'), main)
const exe = path.join(WORK, 'dbg.exe')
execFileSync('g++', ['-std=c++17', '-O1', '-I', WORK, '-o', exe, path.join(WORK, 'main.cpp')], { stdio: 'pipe' })
const ppm = path.join(WORK, 'out.ppm')
console.log('device:', execFileSync(exe, [ppm]).toString().trim())

function readPPM(file: string): Uint8Array {
  const b = fs.readFileSync(file)
  let p = 0
  for (let k = 0; k < 3; k++) {
    while (b[p] !== 10) p++
    p++
  }
  return new Uint8Array(b.subarray(p))
}

const anim = project.animations[animIndex]
const t = collectAnimationBreakpoints(anim)[frameIdx]
const left = sampleAnimationEye(anim, t, 'left')
const right = sampleAnimationEye(anim, t, 'right')
const frameColors = sampleAnimationColors(anim, t, project.colors)
console.log(
  `studio: w=${left.width} h=${left.height} rot=${left.rotation} dist=${left.distance} ` +
    `posX=${left.eyePosX} posY=${left.eyePosY} upLid=${left.upperEyelid} upTilt=${left.upperEyelidTilt}`
)

const colors = project.colors as unknown as Record<string, string>
const display = project.display as unknown as { shape?: string; cornerRadius?: number }
const out = createCanvas(W * 2 + 12, H)
const octx = out.getContext('2d')
octx.fillStyle = '#202020'
octx.fillRect(0, 0, W * 2 + 12, H)

const studioCanvas = createCanvas(W, H)
const ctx = studioCanvas.getContext('2d') as unknown as CanvasRenderingContext2D
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
octx.drawImage(studioCanvas, 0, 0)

const dev = readPPM(ppm)
const devCanvas = createCanvas(W, H)
const dctx = devCanvas.getContext('2d')
const img = dctx.createImageData(W, H)
for (let i = 0; i < W * H; i++) {
  img.data[i * 4] = dev[i * 3]
  img.data[i * 4 + 1] = dev[i * 3 + 1]
  img.data[i * 4 + 2] = dev[i * 3 + 2]
  img.data[i * 4 + 3] = 255
}
dctx.putImageData(img, 0, 0)
octx.drawImage(devCanvas, W + 12, 0)

fs.writeFileSync(outPath, out.toBuffer('image/png'))
fs.rmSync(WORK, { recursive: true, force: true })
console.log(`wrote ${outPath}  (left = STUDIO, right = DEVICE)`)
