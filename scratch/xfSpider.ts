import fs from 'fs'
import { bakeEyeRotation } from '../src/lib/export/cppExport'
import type { Project, EyeParams } from '../src/types'
const raw = JSON.parse(fs.readFileSync('C:/Users/minhl/OneDrive/Desktop/Kibo V1/spiderman.kiboeyes','utf-8'))
const orig = JSON.parse(JSON.stringify(raw.project)) as Project
const baked = bakeEyeRotation(JSON.parse(JSON.stringify(raw.project)) as Project)
const SEG = 24
// studio's analytic rounded rect, same corner parametrisation my polygoniser uses
const studioDefault = (p: EyeParams, sign: number) => {
  const hx = p.width/2, hy = p.height/2
  const rx = Math.max(0, Math.min(p.radius, hx)), ry = Math.max(0, Math.min(p.radius, hy))
  const a = (Math.round(p.rotation*sign)*Math.PI)/180, c = Math.cos(a), s = Math.sin(a)
  const fx = p.eyeShapeFlipH ? -1 : 1, fy = p.eyeShapeFlipV ? -1 : 1
  const out: [number,number][] = []
  const corners: [number,number,number][] = [
    [hx-rx, -hy+ry, -Math.PI/2],[hx-rx, hy-ry, 0],[-hx+rx, hy-ry, Math.PI/2],[-hx+rx, -hy+ry, Math.PI]]
  for (const [ccx,ccy,a0] of corners)
    for (let i=0;i<=SEG;i++){
      const t=a0+(i/SEG)*(Math.PI/2)
      const lx = ccx + rx*Math.cos(t), ly = ccy + ry*Math.sin(t)
      const x = sign*p.eyeShapeOffsetX + fx*lx, y = p.eyeShapeOffsetY + fy*ly
      out.push([x*c-y*s, x*s+y*c])
    }
  return out
}
let worst=0, name=''
const walk=(o:EyeParams|null|undefined,b:EyeParams|null|undefined,sign:number,where:string)=>{
  if(!o||!b) return
  if(Math.round(o.rotation)===0) return
  if(!(o.eyeShape==='default'||!o.eyeShapeVisible)) return
  const bp = baked.customEyeShapes.find(s=>s.id===b.eyeCustomShapeId)?.points
  if(!bp) return
  const rx=(b.width/2)*((b.eyeShapeScale||100)/100), ry=(b.height/2)*((b.eyeShapeScale||100)/100)
  const S=studioDefault(o,sign)
  if(S.length!==bp.length){ console.log('LEN MISMATCH',where,S.length,bp.length); return }
  for(let j=0;j<S.length;j++){
    const d=Math.hypot(S[j][0]-bp[j][0]*rx, S[j][1]-bp[j][1]*ry)
    if(d>worst){worst=d;name=where}
  }
}
for(let i=0;i<orig.expressions.length;i++){
  const o=orig.expressions[i], b=baked.expressions[i]
  walk(o.leftParams??o.params, b.leftParams??b.params, 1, o.name+'/L')
  walk(o.rightParams??o.params, b.rightParams??b.params, -1, o.name+'/R')
}
console.log('max DEFAULT-shape deviation:', worst.toFixed(4), 'px  at', name)
