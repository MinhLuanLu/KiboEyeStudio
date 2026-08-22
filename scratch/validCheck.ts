import fs from 'fs'
import { validateEyeRotationExport } from '../src/lib/export/validateEyeRotation'
import type { Project } from '../src/types'
const raw = JSON.parse(fs.readFileSync('C:/Users/minhl/OneDrive/Desktop/Kibo V1/spiderman.kiboeyes','utf-8'))
const r = validateEyeRotationExport(JSON.parse(JSON.stringify(raw.project)) as Project)
const by: Record<string, number> = {}
r.forEach(x => { by[x.status] = (by[x.status] || 0) + 1 })
console.log('rotated locations reported:', r.length, by)
const w = r.find(x => x.status === 'warning')
console.log('sample warning:', w ? w.locationName + ' :: ' + w.messages[0] : 'none')
