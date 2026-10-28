import { useDb } from '../../db/client'
import { listStrategies } from '../../lib/strategies'

export default defineEventHandler((event) => {
  const { prospectId } = getQuery(event)
  return listStrategies(useDb(), { prospectId: prospectId ? Number(prospectId) : undefined })
})
