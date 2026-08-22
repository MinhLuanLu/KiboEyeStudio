import fs from 'fs'
import { bakeEyeRotation } from '../src/lib/export/cppExport'
import { eyelidTaper } from '../src/renderer/eyelidCurve'
const raw = JSON.parse(fs.readFileSync('C:/Users/minhl/OneDrive/Desktop/Kibo V1/spiderman.kiboeyes','utf-8'))
const orig = JSON.parse(JSON.stringify(raw.project))
const baked = bakeEyeRotation(JSON.parse(JSON.stringify(raw.project)))
const A = orig.animations.find((x:any)=>x.id==='m8CNIA7V_r')
const B = baked.animations.find((x:any)=>x.id==='m8CNIA7V_r')

const shapes = (pr:any)=> new Map((pr.customEyeShapes||[]).map((s:any)=>[s.id,s.points]))
const SO = shapes(orig), SB = shapes(baked)

const sh=(p:any)=>({leftRoundness:p.upperEyelidLeftRoundness,rightRoundness:p.upperEyelidRightRoundness,width:p.upperEyelidStretchX,centerDepth:p.upperEyelidCenterDepth,centerX:p.upperEyelidSkew,smoothness:p.upperEyelidSmoothness,tension:p.upperEyelidTension}) as any
function yCut(p:any,x:number,up:boolean){const cv=up?p.upperEyelid:p.lowerEyelid;if(!(cv>0))return null
  const h=p.height,hy=h/2,hx=p.width/2,sg=up?1:-1
  const cy=Math.max(-100,Math.min(100,up?p.upperEyelidCenterY:p.lowerEyelidCenterY))
  const y0=(up?-hy+(cv/100)*h:hy-(cv/100)*h)+sg*((cy/100)*h*0.25)
  const amp=Math.max(0,Math.min(200,up?p.upperEyelidStretchY:p.lowerEyelidStretchY))/100
  const off=((up?p.upperEyelidCurvature:p.lowerEyelidCurvature)/100)*h*0.5*amp
  const sl=Math.tan(((up?p.upperEyelidTilt:p.lowerEyelidTilt)*Math.PI)/180)
  const u=hx>0.01?Math.max(-1,Math.min(1,x/hx)):0
  return y0+sl*x+sg*off*eyelidTaper(u,sh(p))}
const lidCovers=(p:any,x:number,y:number)=>{const a=yCut(p,x,true),b=yCut(p,x,false);return (a!==null&&y<a)||(b!==null&&y>b)}

function inShape(p:any,S:Map<string,any>,sign:number,x:number,y:number){
  const hx=p.width/2, hy=p.height/2
  const pts = p.eyeShape==='custom'&&p.eyeShapeId ? S.get(p.eyeShapeId) : null
  if(pts){
    const k=(p.eyeShapeScale||100)/100, rx=hx*k, ry=hy*k
    const fx=p.eyeShapeFlipH?-1:1, fy=p.eyeShapeFlipV?-1:1
    const ox=sign*(p.eyeShapeOffsetX||0), oy=p.eyeShapeOffsetY||0
    let inside=false
    for(let i=0,j=pts.length-1;i<pts.length;j=i++){
      const xi=ox+fx*pts[i][0]*rx, yi=oy+fy*pts[i][1]*ry
      const xj=ox+fx*pts[j][0]*rx, yj=oy+fy*pts[j][1]*ry
      if((yi>y)!==(yj>y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside}
    return inside}
  const rx=Math.min(p.radius,hx), ry=Math.min(p.radius,hy)
  const ax=Math.abs(x), ay=Math.abs(y)
  if(ax>hx||ay>hy) return false
  const cx=hx-rx, cy2=hy-ry
  if(ax<=cx||ay<=cy2) return true
  const dx=(ax-cx)/rx, dy=(ay-cy2)/ry
  return dx*dx+dy*dy<=1}

const W=240,H=240
function raster(p:any,S:Map<string,any>,sign:number,rotDeg:number,cxp:number){
  const a=rotDeg*Math.PI/180, c=Math.cos(a), s=Math.sin(a)
  const out:string[]=[]
  for(let py=0;py<H;py++){ let run=-1
    for(let px=0;px<=W;px++){
      const X=px-cxp, Y=py-H/2
      const lx=X*c+Y*s, ly=-X*s+Y*c
      const on = px<W && inShape(p,S,sign,lx,ly) && !lidCovers(p,lx,ly)
      if(on&&run<0) run=px
      else if(!on&&run>=0){ out.push(`<rect x="${run}" y="${py}" width="${px-run}" height="1"/>`); run=-1 }}}
  return out.join('')}

const ko=A.keyframes[0], kb=B.keyframes[0]
const panels=[
  {t:'STUDIO PREVIEW (true rotation)', L:[ko.leftParams??ko.params,SO,1,50], R:[ko.rightParams??ko.params,SO,-1,-50]},
  {t:'FIRMWARE (baked, what eyes.h draws)', L:[kb.leftParams??kb.params,SB,1,0], R:[kb.rightParams??kb.params,SB,-1,0]},
]
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="560" height="330" viewBox="0 0 560 330"><rect width="560" height="330" fill="#1a1a1a"/>`
panels.forEach((pn,i)=>{const ox=20+i*280
  svg+=`<text x="${ox+120}" y="24" fill="#ddd" font-family="sans-serif" font-size="13" text-anchor="middle">${pn.t}</text>`
  svg+=`<g transform="translate(${ox},36)"><clipPath id="c${i}"><circle cx="120" cy="120" r="120"/></clipPath><g clip-path="url(#c${i})"><rect width="240" height="240" fill="#000"/><g fill="#cfe8ff">`
  const [lp,ls,lsg,lr]=pn.L as any; const [rp,rs,rsg,rr]=pn.R as any
  svg+=raster(lp,ls,lsg,lr,72)+raster(rp,rs,rsg,rr,168)
  svg+=`</g></g><circle cx="120" cy="120" r="120" fill="none" stroke="#2f6ea8" stroke-width="3"/></g>`})
svg+=`<text x="280" y="322" fill="#888" font-family="sans-serif" font-size="11" text-anchor="middle">Idle keyframe 0 — rot 50, 104x100, radius 130, Disable Eyelid, upper lid 40%</text></svg>`
fs.writeFileSync('scratch/compare.svg',svg)
console.log('wrote scratch/compare.svg')
