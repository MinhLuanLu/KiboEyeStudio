import fs from 'fs'
import { bakeEyeRotation } from '../src/lib/export/cppExport'
import type { Project, EyeParams } from '../src/types'
const raw = JSON.parse(fs.readFileSync('C:/Users/minhl/OneDrive/Desktop/Robo/Kibo.kiboeyes','utf-8'))
const baked = bakeEyeRotation(raw.project as Project)
let shown = 0
const chk = (x: EyeParams | null | undefined, where: string) => {
  if (!x || Math.round(x.rotation) % 360 === 0) return
  if (shown++ < 6)
    console.log(where, JSON.stringify({ rot: x.rotation, shape: x.eyeShape, vis: x.eyeShapeVisible,
      w: x.width, h: x.height, r: x.radius, sc: x.eyeShapeScale, id: x.eyeCustomShapeId }))
}
for (const e of baked.expressions) { chk(e.params,'expr '+e.name); chk(e.leftParams,'exprL '+e.name); chk(e.rightParams,'exprR '+e.name) }
for (const a of baked.animations)
  for (const [n, arr] of [['kf',a.keyframes],['L',a.leftEyeKeyframes],['R',a.rightEyeKeyframes],['pupil',a.pupilKeyframes],['lid',a.eyelidKeyframes]] as const)
    for (const k of arr) { chk(k.params, a.name+'/'+n); chk(k.leftParams, a.name+'/'+n+'L'); chk(k.rightParams, a.name+'/'+n+'R') }
console.log('total remaining:', shown)
