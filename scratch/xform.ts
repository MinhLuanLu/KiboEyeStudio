import fs from 'fs'
import { bakeEyeRotation } from '../src/lib/export/cppExport'
import { EYE_SHAPE_POLYGONS } from '../src/renderer/eyeShapes'
import type { Project, EyeParams } from '../src/types'

const raw = JSON.parse(fs.readFileSync('C:/Users/minhl/OneDrive/Desktop/Robo/Kibo.kiboeyes','utf-8'))
const orig = JSON.parse(JSON.stringify(raw.project)) as Project
const baked = bakeEyeRotation(JSON.parse(JSON.stringify(raw.project)) as Project)

// studio screen points: R(a) * [ offset + F*S*p ]
const studio = (p: EyeParams, poly: readonly (readonly [number,number])[], sign: number) => {
  const rx = (p.width/2)*((p.eyeShapeScale||100)/100), ry = (p.height/2)*((p.eyeShapeScale||100)/100)
  const fx = p.eyeShapeFlipH ? -1 : 1, fy = p.eyeShapeFlipV ? -1 : 1
  const a = (Math.round(p.rotation*sign)*Math.PI)/180, c = Math.cos(a), s = Math.sin(a)
  return poly.map(([px,py]) => {
    const x = sign*p.eyeShapeOffsetX + fx*px*rx, y = p.eyeShapeOffsetY + fy*py*ry
    return [x*c - y*s, x*s + y*c] as [number,number]
  })
}
// device screen points after bake: offset=0, flip=none, rot=0 -> just S*p'
const device = (p: EyeParams, poly: readonly (readonly [number,number])[]) => {
  const rx = (p.width/2)*((p.eyeShapeScale||100)/100), ry = (p.height/2)*((p.eyeShapeScale||100)/100)
  return poly.map(([px,py]) => [px*rx, py*ry] as [number,number])
}
const polyOf = (proj: Project, p: EyeParams) =>
  p.eyeShape === 'custom' ? proj.customEyeShapes.find(s=>s.id===p.eyeCustomShapeId)?.points ?? null
  : p.eyeShape === 'default' ? null : (EYE_SHAPE_POLYGONS[p.eyeShape] ?? null)

let worst = 0, worstName = ''
for (let i = 0; i < orig.expressions.length; i++) {
  const o = orig.expressions[i], b = baked.expressions[i]
  for (const [k, sign] of [['leftParams',1],['rightParams',-1]] as const) {
    const op = (o as any)[k] ?? o.params, bp = (b as any)[k] ?? b.params
    if (!op || Math.round(op.rotation) === 0) continue
    const opoly = polyOf(orig, op); const bpoly = polyOf(baked, bp)
    if (!opoly || !bpoly || opoly.length !== bpoly.length) continue
    const S = studio(op, opoly, sign), D = device(bp, bpoly)
    for (let j = 0; j < S.length; j++) {
      const d = Math.hypot(S[j][0]-D[j][0], S[j][1]-D[j][1])
      if (d > worst) { worst = d; worstName = `${o.name}/${k}` }
    }
  }
}
console.log('max studio-vs-baked deviation:', worst.toFixed(4), 'px   at', worstName)
