import { useDb } from '../../../db/client'
import { listSources, runningImport } from '../../../lib/portfolio'

export default defineEventHandler(() => {
  const db = useDb()
  return { sources: listSources(db), running: runningImport(db) ?? null }
})
