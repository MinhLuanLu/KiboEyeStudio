import fs from 'fs'
import { bakeEyeRotation } from '../src/lib/export/cppExport'
import type { Project, EyeParams } from '../src/types'
const raw = JSON.parse(fs.readFileSync('C:/Users/minhl/OneDrive/Desktop/Robo/Kibo.kiboeyes','utf-8'))
const baked = bakeEyeRotation(raw.project as Project)
const why: Record<string, number> = {}
const chk = (x: EyeParams | null | undefined) => {
  if (!x || Math.round(x.rotation) % 360 === 0) return
  const r: string[] = []
  if (x.eyeShapeOffsetX !== 0 || x.eyeShapeOffsetY !== 0) r.push('offset')
  if (x.eyeShapeFlipH) r.push('flipH')
  if (x.eyeShapeFlipV) r.push('flipV')
  if (!(x.width > 0 && x.height > 0)) r.push('zeroSize')
  if (!x.eyeShapeVisible) r.push('notVisible')
  if (x.eyeShape === 'custom' && !x.eyeCustomShapeId) r.push('noCustomId')
  const key = `${x.eyeShape}: ${r.length ? r.join('+') : 'UNKNOWN'}`
  why[key] = (why[key] ?? 0) + 1
}
for (const e of baked.expressions) { chk(e.params); chk(e.leftParams); chk(e.rightParams) }
for (const a of baked.animations)
  for (const arr of [a.keyframes, a.leftEyeKeyframes, a.rightEyeKeyframes, a.pupilKeyframes, a.eyelidKeyframes])
    for (const k of arr) { chk(k.params); chk(k.leftParams); chk(k.rightParams) }
console.log('remaining unbaked, by reason:')
for (const [k, v] of Object.entries(why).sort((a,b)=>b[1]-a[1])) console.log('  ', v, '\t', k)
