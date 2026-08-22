import fs from 'fs'
import { bakeEyeRotation } from '../src/lib/export/cppExport'
import { eyelidTaper } from '../src/renderer/eyelidCurve'
import type { Project, EyeParams } from '../src/types'
const raw = JSON.parse(fs.readFileSync('C:/Users/minhl/OneDrive/Desktop/Robo/Kibo.kiboeyes','utf-8'))
const orig = JSON.parse(JSON.stringify(raw.project)) as Project
const baked = bakeEyeRotation(JSON.parse(JSON.stringify(raw.project)) as Project)
const shapeOf = (p: EyeParams, up: boolean) => ({
  leftRoundness: up?p.upperEyelidLeftRoundness:p.lowerEyelidLeftRoundness,
  rightRoundness: up?p.upperEyelidRightRoundness:p.lowerEyelidRightRoundness,
  width: up?p.upperEyelidStretchX:p.lowerEyelidStretchX,
  centerDepth: up?p.upperEyelidCenterDepth:p.lowerEyelidCenterDepth,
  centerX: up?p.upperEyelidSkew:p.lowerEyelidSkew,
  smoothness: up?p.upperEyelidSmoothness:p.lowerEyelidSmoothness,
  tension: up?p.upperEyelidTension:p.lowerEyelidTension
})
const cutoff = (p: EyeParams, up: boolean, x: number) => {
  const h=p.height, hy=h/2, hx=p.width/2
  const cov=((up?p.upperEyelid:p.lowerEyelid)/100)*h
  const cy=((up?p.upperEyelidCenterY:p.lowerEyelidCenterY)/100)*h*0.25
  const yBase = up ? -hy+cov+cy : hy-cov-cy
  const m = Math.tan((up?p.upperEyelidTilt:p.lowerEyelidTilt)*Math.PI/180)
  const curve = ((up?p.upperEyelidCurvature:p.lowerEyelidCurvature)/100)*h*0.5
  const amp = Math.max(0, Math.min(2, (up?p.upperEyelidStretchY:p.lowerEyelidStretchY)/100))
  const off = curve*amp*(up?1:-1)
  let u = hx>0.01 ? x/hx : 0; u = Math.max(-1, Math.min(1, u))
  return yBase + m*x + off*eyelidTaper(u, shapeOf(p,up) as any)
}
let worst=0, name='', n=0, curvedN=0
const walk=(o:EyeParams|null|undefined,b:EyeParams|null|undefined,sign:number,where:string)=>{
  if(!o||!b||Math.round(o.rotation)===0||o.disableEyelid) return
  const a=(Math.round(o.rotation*sign)*Math.PI)/180, c=Math.cos(a), s=Math.sin(a)
  for(const up of [true,false]){
    if(!((up?o.upperEyelid:o.lowerEyelid)>0)) continue
    n++
    const curv = up?o.upperEyelidCurvature:o.lowerEyelidCurvature
    if(Math.abs(curv)>0.5) curvedN++
    for(let x=-o.width/2; x<=o.width/2; x+=2){
      const y=cutoff(o,up,x)
      const X=x*c-y*s, Y=x*s+y*c        // studio point rotated
      const Yb=cutoff(b,up,X)            // baked lid at same X
      const d=Math.abs(Y-Yb)
      if(d>worst){worst=d;name=where+(up?'/upper':'/lower')+` curv=${curv}`}
    }
  }
}
for(let i=0;i<orig.expressions.length;i++){
  const o=orig.expressions[i], b=baked.expressions[i]
  walk(o.leftParams??o.params,b.leftParams??b.params,1,o.name+'/L')
  walk(o.rightParams??o.params,b.rightParams??b.params,-1,o.name+'/R')
}
console.log('lids checked:', n, ' of which curved:', curvedN)
console.log('max FULL lid-cutoff deviation (incl. taper):', worst.toFixed(2), 'px')
console.log('worst:', name)
