import fs from 'fs'
const raw = JSON.parse(fs.readFileSync('C:/Users/minhl/OneDrive/Desktop/Kibo V1/spiderman.kiboeyes','utf-8'))
let on=0, off=0
for (const e of raw.project.expressions) for (const s of ['leftParams','rightParams']) {
  const p = e[s] ?? e.params; if (!p || Math.round(p.rotation??0)===0) continue
  p.disableEyelid ? on++ : off++
}
console.log('rotated poses WITH disableEyelid:', on, ' without:', off)
const n = raw.project.expressions.find((e:any)=>e.name==='Neutral')
console.log('Neutral L disableEyelid =', (n.leftParams??n.params).disableEyelid)
