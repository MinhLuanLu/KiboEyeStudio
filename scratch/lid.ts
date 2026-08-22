import fs from 'fs'
import { bakeEyeRotation } from '../src/lib/export/cppExport'
import type { Project, EyeParams } from '../src/types'
const raw = JSON.parse(fs.readFileSync('C:/Users/minhl/OneDrive/Desktop/Robo/Kibo.kiboeyes','utf-8'))
const orig = JSON.parse(JSON.stringify(raw.project)) as Project
const baked = bakeEyeRotation(JSON.parse(JSON.stringify(raw.project)) as Project)
const lidLine = (p: EyeParams, upper: boolean) => {
  const h=p.height, hy=h/2
  const cov=((upper?p.upperEyelid:p.lowerEyelid)/100)*h
  const cy=((upper?p.upperEyelidCenterY:p.lowerEyelidCenterY)/100)*h*0.25
  const tilt=upper?p.upperEyelidTilt:p.lowerEyelidTilt
  return { yBase: upper ? -hy+cov+cy : hy-cov-cy, m: Math.tan(tilt*Math.PI/180) }
}
let worst=0, name='', baked_n=0, skipped=0, total=0
const walk=(o:EyeParams|null|undefined,b:EyeParams|null|undefined,sign:number,where:string)=>{
  if(!o||!b||Math.round(o.rotation)===0||o.disableEyelid) return
  const a=(Math.round(o.rotation*sign)*Math.PI)/180, c=Math.cos(a), s=Math.sin(a)
  for(const up of [true,false]){
    const cov = up?o.upperEyelid:o.lowerEyelid
    if(!(cov>0)) continue
    total++
    const O=lidLine(o,up), B=lidLine(b,up)
    const tiltChanged = (up?b.upperEyelidTilt:b.lowerEyelidTilt) !== (up?o.upperEyelidTilt:o.lowerEyelidTilt)
    if(!tiltChanged){ skipped++; continue }
    baked_n++
    for(const x of [-40,-20,0,20,40]){
      const y=O.yBase+O.m*x
      const X=x*c-y*s, Y=x*s+y*c            // studio: rotate the lid point
      const Yb=B.yBase+B.m*X                 // baked: lid line evaluated at same X
      const d=Math.abs(Y-Yb)
      if(d>worst){worst=d;name=where+(up?'/upper':'/lower')}
    }
  }
}
for(let i=0;i<orig.expressions.length;i++){
  const o=orig.expressions[i], b=baked.expressions[i]
  walk(o.leftParams??o.params,b.leftParams??b.params,1,o.name+'/L')
  walk(o.rightParams??o.params,b.rightParams??b.params,-1,o.name+'/R')
}
for(let i=0;i<orig.animations.length;i++){
  const oa=orig.animations[i], ba=baked.animations[i]
  for(let j=0;j<oa.keyframes.length;j++)
    walk(oa.keyframes[j].leftParams??oa.keyframes[j].params, ba.keyframes[j].leftParams??ba.keyframes[j].params,1,oa.name+'#'+j)
}
console.log('lids on rotated poses :', total)
console.log('  baked               :', baked_n)
console.log('  left alone (range)  :', skipped)
console.log('max lid-line deviation:', worst.toFixed(4),'px  worst:',name)
