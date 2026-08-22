import fs from 'fs'
import { generateCppHeader } from '../src/lib/export/cppExport'
import type { Project } from '../src/types'
const raw = JSON.parse(fs.readFileSync('C:/Users/minhl/OneDrive/Desktop/Kibo V1/spiderman.kiboeyes','utf-8'))
const mine = generateCppHeader(JSON.parse(JSON.stringify(raw.project)) as Project, { bakeRotation: true, includeExpressions: true } as any)
fs.writeFileSync('scratch/eyes_mine.h', mine)
const disk = fs.readFileSync('C:/Users/minhl/OneDrive/Desktop/Kibo V1/spiderman/spiderman/eyes.h','utf-8')
console.log('mine bytes:', mine.length, ' disk bytes:', disk.length)
console.log('identical :', mine === disk)
const dl = disk.split('\n'), ml = mine.split('\n')
for (let i=0;i<Math.max(dl.length,ml.length);i++) if (dl[i]!==ml[i]) {
  console.log('first diff at line', i+1)
  console.log('  disk:', (dl[i]??'<eof>').slice(0,140))
  console.log('  mine:', (ml[i]??'<eof>').slice(0,140))
  break
}
