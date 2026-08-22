import fs from 'fs'
import { generateCppHeader } from '../src/lib/export/cppExport'
import type { Project } from '../src/types'
const project = JSON.parse(fs.readFileSync('C:/Users/minhl/OneDrive/Desktop/Robo/Kibo.kiboeyes','utf-8')).project as Project
for (const bake of [false, true]) {
  const h = generateCppHeader(project, { includeExpressions: true, bakeRotation: bake })
  console.log(`bakeRotation=${String(bake).padEnd(5)} EYES_FORCE_ROTATION emitted:`,
    h.includes('#define EYES_FORCE_ROTATION'), ' size:', (h.length/1024).toFixed(1)+' KB')
}
