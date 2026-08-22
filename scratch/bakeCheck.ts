import fs from 'fs'
import { bakeEyeRotation } from '../src/lib/export/cppExport'
import type { Project, EyeParams } from '../src/types'

const raw = JSON.parse(fs.readFileSync('C:/Users/minhl/OneDrive/Desktop/Robo/Kibo.kiboeyes', 'utf-8'))
const project = raw.project as Project

const count = (p: Project) => {
  let rot = 0, tot = 0
  const chk = (x: EyeParams | null | undefined) => {
    if (!x) return
    tot++
    if (Math.round(x.rotation) % 360 !== 0) rot++
  }
  for (const e of p.expressions) { chk(e.params); chk(e.leftParams); chk(e.rightParams) }
  for (const a of p.animations)
    for (const arr of [a.keyframes, a.leftEyeKeyframes, a.rightEyeKeyframes, a.pupilKeyframes, a.eyelidKeyframes])
      for (const k of arr) { chk(k.params); chk(k.leftParams); chk(k.rightParams) }
  return { rot, tot }
}

const before = count(project)
const baked = bakeEyeRotation(project)
const after = count(baked)
console.log('rotated poses BEFORE bake:', before.rot, '/', before.tot)
console.log('rotated poses AFTER  bake:', after.rot, '/', after.tot)
console.log('baked polygons created   :', baked.customEyeShapes.length - project.customEyeShapes.length + baked.customEyeShapes.filter(s => s.id.startsWith('bakedrot_')).length * 0 || baked.customEyeShapes.filter(s => s.id.startsWith('bakedrot_')).length)
const pts = baked.customEyeShapes.filter(s => s.id.startsWith('bakedrot_'))
console.log('polygon count            :', pts.length)
console.log('total points             :', pts.reduce((n, s) => n + s.points.length, 0))
console.log('flash (2x int16/pt)      :', (pts.reduce((n, s) => n + s.points.length, 0) * 4 / 1024).toFixed(1), 'KB')
