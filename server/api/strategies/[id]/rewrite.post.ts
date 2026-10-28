import { useDb } from '../../../db/client'
import { enqueueStrategy, getStrategy } from '../../../lib/strategies'

/** La riscrive con le stesse persone e le note di William. */
export default defineEventHandler((event) => {
  try {
    const db = useDb()
    const strategy = getStrategy(db, idParam(event))
    return enqueueStrategy(db, strategy.prospectIds, 'dashboard', { strategyId: strategy.id })
  }
  catch (err) {
    toHttpError(err)
  }
})
