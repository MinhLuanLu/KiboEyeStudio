import fs from 'fs'
import { bakeEyeRotation } from '../src/lib/export/cppExport'
import { eyelidTaper } from '../src/renderer/eyelidCurve'
import type { Project, EyeParams } from '../src/types'
const raw = JSON.parse(fs.readFileSync('C:/Users/minhl/OneDrive/Desktop/Kibo V1/spiderman.kiboeyes','utf-8'))
const orig  = JSON.parse(JSON.stringify(raw.project)) as Project
const baked = bakeEyeRotation(JSON.parse(JSON.stringify(raw.project)) as Project)
const sh = (p:any)=>({leftRoundness:p.upperEyelidLeftRoundness,rightRoundness:p.upperEyelidRightRoundness,width:p.upperEyelidStretchX,centerDepth:p.upperEyelidCenterDepth,centerX:p.upperEyelidSkew,smoothness:p.upperEyelidSmoothness,tension:p.upperEyelidTension}) as any
function yCut(p:any,x:number,up:boolean){const cov=up?p.upperEyelid:p.lowerEyelid;if(!(cov>0))return null
  const h=p.height,hy=h/2,hx=p.width/2,sg=up?1:-1
  const cy=Math.max(-100,Math.min(100,up?p.upperEyelidCenterY:p.lowerEyelidCenterY))
  const y0=(up?-hy+(cov/100)*h:hy-(cov/100)*h)+sg*((cy/100)*h*0.25)
  const amp=Math.max(0,Math.min(200,up?p.upperEyelidStretchY:p.lowerEyelidStretchY))/100
  const off=((up?p.upperEyelidCurvature:p.lowerEyelidCurvature)/100)*h*0.5*amp
  const sl=Math.tan(((up?p.upperEyelidTilt:p.lowerEyelidTilt)*Math.PI)/180)
  const u=hx>0.01?Math.max(-1,Math.min(1,x/hx)):0
  return y0+sl*x+sg*off*eyelidTaper(u,sh(p))}
const cov=(p:any,x:number,y:number)=>{const a=yCut(p,x,true),b=yCut(p,x,false);return (a!==null&&y<a)||(b!==null&&y>b)}
const pairs:{n:string;o:any;k:any}[]=[]
orig.expressions.forEach((e:any,i:number)=>{const b:any=baked.expressions[i]
  ;['leftParams','rightParams'].forEach(s=>pairs.push({n:`expr ${e.name}.${s}`,o:e[s]??e.params,k:b[s]??b.params}))})
const A=['keyframes','leftEyeKeyframes','rightEyeKeyframes','pupilKeyframes','eyelidKeyframes']
orig.animations.forEach((a:any,i:number)=>{const b:any=baked.animations[i]
  A.forEach(kk=>(a[kk]||[]).forEach((_:any,j:number)=>['leftParams','rightParams'].forEach(s=>
    pairs.push({n:`anim ${a.name}.${kk}[${j}].${s}`,o:a[kk][j][s]??a[kk][j].params,k:b[kk][j][s]??b[kk][j].params}))))})
let tot=0,bad=0,worst=0,wn=''
for(const {n,o,k} of pairs){ if(!o||Math.round(o.rotation??0)===0) continue
  const sgn = n.endsWith('leftParams')?1:-1, ang=(o.rotation)*sgn*Math.PI/180
  const c=Math.cos(ang),s=Math.sin(ang),r=Math.max(o.width,o.height)
  let b2=0,nn=0
  for(let y=-r;y<=r;y+=1.5)for(let x=-r;x<=r;x+=1.5){
    const lx=x*c+y*s, ly=-x*s+y*c
    if(cov(o,lx,ly)!==cov(k,x,y))b2++; nn++}
  tot+=nn;bad+=b2;const pc=100*b2/nn; if(pc>worst){worst=pc;wn=n}}
console.log('rotated poses checked :', pairs.filter(p=>p.o&&Math.round(p.o.rotation??0)!==0).length)
console.log('overall disagreement  :', (100*bad/tot).toFixed(3),'%')
console.log('worst                 :', wn, worst.toFixed(2),'%')
