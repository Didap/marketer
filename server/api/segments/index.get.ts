import { useDb } from '../../db/client'
import { listSegments, runningProposal } from '../../lib/prospects'
import { sourcesAvailable } from '../../lib/sources'

export default defineEventHandler(() => {
  const db = useDb()
  return { segments: listSegments(db), sources: sourcesAvailable(), proposal: runningProposal(db) ?? null }
})
