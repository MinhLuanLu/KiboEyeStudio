import fs from 'fs'
import { generateCppHeader, bakeEyeRotation, projectUsesEyeRotation } from '../src/lib/export/cppExport'
import type { Project } from '../src/types'
const raw = JSON.parse(fs.readFileSync('C:/Users/minhl/OneDrive/Desktop/Kibo V1/spiderman.kiboeyes','utf-8'))
const orig = JSON.parse(JSON.stringify(raw.project)) as Project
const baked = bakeEyeRotation(JSON.parse(JSON.stringify(raw.project)) as Project)
console.log('orig  uses rotation :', projectUsesEyeRotation(orig))
console.log('baked uses rotation :', projectUsesEyeRotation(baked))
const code = generateCppHeader(JSON.parse(JSON.stringify(raw.project)) as Project, { bakeRotation: true } as any)
console.log('#define EYES_FORCE_ROTATION emitted :', /#\s*define\s+EYES_FORCE_ROTATION/.test(code))
console.log('flash size :', (code.length/1024).toFixed(1), 'KB')
