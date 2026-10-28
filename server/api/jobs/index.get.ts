import { useDb } from '../../db/client'
import { listJobs } from '../../lib/jobs'

export default defineEventHandler((event) => {
  const limit = Math.min(200, Math.max(1, Number(getQuery(event).limit) || 50))
  return listJobs(useDb(), { limit }).map(({ prompt: _prompt, result: _result, ...job }) => job)
})
