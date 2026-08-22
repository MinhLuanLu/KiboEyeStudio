import fs from 'fs'
import { bakeEyeRotation } from '../src/lib/export/cppExport'
import { eyelidTaper } from '../src/renderer/eyelidCurve'
import type { Project, EyeParams } from '../src/types'

const raw = JSON.parse(fs.readFileSync('C:/Users/minhl/OneDrive/Desktop/Kibo V1/spiderman.kiboeyes','utf-8'))
const orig  = JSON.parse(JSON.stringify(raw.project)) as Project
const baked = bakeEyeRotation(JSON.parse(JSON.stringify(raw.project)) as Project)

const shapeOf = (p: EyeParams) => ({
  leftRoundness: p.upperEyelidLeftRoundness, rightRoundness: p.upperEyelidRightRoundness,
  width: p.upperEyelidStretchX, centerDepth: p.upperEyelidCenterDepth,
  centerX: p.upperEyelidSkew, smoothness: p.upperEyelidSmoothness, tension: p.upperEyelidTension
}) as any

// yCutoff exactly as BOTH drawEye.ts (557-563/641-646) and cppExport.ts (2113-2172) compute it
function yCut(p: EyeParams, x: number, upper: boolean): number | null {
  const cov = upper ? p.upperEyelid : p.lowerEyelid
  if (!(cov > 0)) return null
  const h = p.height, hy = h/2, hx = p.width/2, sign = upper ? 1 : -1
  const cyPct = Math.max(-100, Math.min(100, upper ? p.upperEyelidCenterY : p.lowerEyelidCenterY))
  const y0 = (upper ? -hy + (cov/100)*h : hy - (cov/100)*h) + sign*((cyPct/100)*h*0.25)
  const amp = Math.max(0, Math.min(200, upper ? p.upperEyelidStretchY : p.lowerEyelidStretchY))/100
  const off = ((upper ? p.upperEyelidCurvature : p.lowerEyelidCurvature)/100)*h*0.5*amp
  const slope = Math.tan(((upper ? p.upperEyelidTilt : p.lowerEyelidTilt)*Math.PI)/180)
  const u = hx > 0.01 ? Math.max(-1, Math.min(1, x/hx)) : 0
  return y0 + slope*x + sign*off*eyelidTaper(u, shapeOf(p))
}
const covered = (p: EyeParams, x: number, y: number) => {
  const up = yCut(p, x, true), lo = yCut(p, x, false)
  return (up !== null && y < up) || (lo !== null && y > lo)
}

let worst = 0, worstName = '', total = 0, diffs = 0
for (const e of orig.expressions) {
  const b = baked.expressions.find((z: any) => z.id === e.id)!
  for (const side of ['leftParams','rightParams'] as const) {
    const o = (e as any)[side] ?? e.params, k = (b as any)[side] ?? b.params
    const a = (o.rotation ?? 0) * (side === 'leftParams' ? 1 : -1)
    if (Math.round(o.rotation ?? 0) === 0) continue
    const r = Math.max(o.width, o.height)
    const c = Math.cos(a*Math.PI/180), s = Math.sin(a*Math.PI/180)
    let bad = 0, n = 0
    for (let y = -r; y <= r; y += 1) for (let x = -r; x <= r; x += 1) {
      // studio: rotate screen point back into eye-local, apply ORIGINAL lid
      const lx =  x*c + y*s, ly = -x*s + y*c
      const A = covered(o, lx, ly)
      const B = covered(k, x, y)   // firmware: BAKED lid, no rotation
      n++; if (A !== B) bad++
    }
    total += n; diffs += bad
    const pct = (100*bad)/n
    if (pct > worst) { worst = pct; worstName = `${e.name} ${side}` }
  }
}
console.log('lid-mask disagreement overall :', ((100*diffs)/total).toFixed(3), '%')
console.log('worst expression             :', worstName, worst.toFixed(3), '%')

// --- isolate: Neutral left, compare the two cutoff curves directly ---
const ne = orig.expressions.find((e:any)=>e.name==='Neutral')!
const nb = baked.expressions.find((e:any)=>e.id===ne.id)!
const o:any = (ne as any).leftParams ?? ne.params, k:any = (nb as any).leftParams ?? nb.params
const a = (o.rotation)*Math.PI/180, c=Math.cos(a), s=Math.sin(a)
console.log('\nNeutral L rot=',o.rotation,'cov=',o.upperEyelid,'tilt=',o.upperEyelidTilt,'curv=',o.upperEyelidCurvature,'stretchY=',o.upperEyelidStretchY)
console.log('baked   cov=',k.upperEyelid.toFixed(2),'tilt=',k.upperEyelidTilt.toFixed(2),'cY=',k.upperEyelidCenterY.toFixed(2))
console.log(' X    studio-rotated-Ycut   baked-Ycut   delta')
for (const X of [-40,-20,0,20,40]) {
  // studio: find local x whose rotated image has screen X, then rotate the cutoff point to screen
  let best: number|null = null, bd = 1e9
  for (let lx=-200; lx<=200; lx+=0.05) {
    const ly = yCut(o, lx, true); if (ly===null) continue
    const sx = lx*c - ly*s
    if (Math.abs(sx-X) < bd) { bd=Math.abs(sx-X); best = lx*s + ly*c }
  }
  const bk = yCut(k, X, true)
  console.log(String(X).padStart(4), String(best!.toFixed(2)).padStart(18), String(bk!.toFixed(2)).padStart(12), (best!-bk!).toFixed(2).padStart(8))
}
