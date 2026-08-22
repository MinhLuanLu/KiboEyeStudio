import fs from 'fs'
import { bakeEyeRotation } from '../src/lib/export/cppExport'
import type { Project, EyeParams } from '../src/types'
const raw = JSON.parse(fs.readFileSync('C:/Users/minhl/OneDrive/Desktop/Robo/Kibo.kiboeyes','utf-8'))
const orig = JSON.parse(JSON.stringify(raw.project)) as Project
const baked = bakeEyeRotation(JSON.parse(JSON.stringify(raw.project)) as Project)
const local = (p: EyeParams, sign: number) => {
  const hw=p.width/2, hh=p.height/2
  const px = sign*(p.pupilX/100)*hw, py = (p.pupilY/100)*hh
  const irX=(p.irisWidth/100)*hw, irY=(p.irisHeight/100)*hh
  const puX=(p.pupilWidth/100)*hw, puY=(p.pupilHeight/100)*hh
  const bX = p.pupilVisible&&puX>0?puX:irX, bY = p.pupilVisible&&puY>0?puY:irY
  const hx = px + sign*(p.highlightX/100)*bX, hy = py + (p.highlightY/100)*bY
  return { px, py, hx, hy }
}
let wp=0, wh=0, name=''
const walk=(o:EyeParams|null|undefined,b:EyeParams|null|undefined,sign:number,where:string)=>{
  if(!o||!b||Math.round(o.rotation)===0) return
  const a=(Math.round(o.rotation*sign)*Math.PI)/180, c=Math.cos(a), s=Math.sin(a)
  const L=local(o,sign), B=local(b,sign)
  const rpx=L.px*c-L.py*s, rpy=L.px*s+L.py*c
  const rhx=L.hx*c-L.hy*s, rhy=L.hx*s+L.hy*c
  const dp=Math.hypot(rpx-B.px, rpy-B.py), dh=Math.hypot(rhx-B.hx, rhy-B.hy)
  if(dp>wp){wp=dp;name=where}
  if(dh>wh) wh=dh
}
for(let i=0;i<orig.expressions.length;i++){
  const o=orig.expressions[i], b=baked.expressions[i]
  walk(o.leftParams??o.params, b.leftParams??b.params, 1, o.name+'/L')
  walk(o.rightParams??o.params, b.rightParams??b.params, -1, o.name+'/R')
}
for(let i=0;i<orig.animations.length;i++){
  const oa=orig.animations[i], ba=baked.animations[i]
  for(let j=0;j<oa.keyframes.length;j++){
    const o=oa.keyframes[j], b=ba.keyframes[j]
    walk(o.leftParams??o.params, b.leftParams??b.params, 1, oa.name+'#'+j+'/L')
    walk(o.rightParams??o.params, b.rightParams??b.params, -1, oa.name+'#'+j+'/R')
  }
}
console.log('max pupil     deviation:', wp.toFixed(4), 'px   worst:', name)
console.log('max highlight deviation:', wh.toFixed(4), 'px')
