import fs from 'fs'
import { bakeEyeRotation } from '../src/lib/export/cppExport'
import type { Project, EyeParams } from '../src/types'
const raw = JSON.parse(fs.readFileSync('C:/Users/minhl/OneDrive/Desktop/Kibo V1/spiderman.kiboeyes','utf-8'))
const orig = JSON.parse(JSON.stringify(raw.project)) as Project
const baked = bakeEyeRotation(JSON.parse(JSON.stringify(raw.project)) as Project)
const show = (tag: string, p: EyeParams | null | undefined) => {
  if (!p) { console.log(tag, 'null'); return }
  console.log(tag, JSON.stringify({ rot: p.rotation, shape: p.eyeShape, vis: p.eyeShapeVisible,
    id: p.eyeCustomShapeId, w: p.width, h: p.height, sc: p.eyeShapeScale,
    offX: p.eyeShapeOffsetX, offY: p.eyeShapeOffsetY, fH: p.eyeShapeFlipH, fV: p.eyeShapeFlipV,
    upLid: p.upperEyelid, upTilt: p.upperEyelidTilt, upCurv: p.upperEyelidCurvature }))
}
for (const name of ['Angry','Neutral']) {
  const o = orig.expressions.find(e => e.name === name)!
  const b = baked.expressions.find(e => e.name === name)!
  console.log('=====', name)
  show('  orig L', o.leftParams ?? o.params); show('  orig R', o.rightParams ?? o.params)
  show('  bake L', b.leftParams ?? b.params); show('  bake R', b.rightParams ?? b.params)
}
