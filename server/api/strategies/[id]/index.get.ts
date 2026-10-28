import { useDb } from '../../../db/client'
import { strategyDetail } from '../../../lib/strategies'

export default defineEventHandler((event) => {
  try {
    return strategyDetail(useDb(), idParam(event))
  }
  catch (err) {
    toHttpError(err)
  }
})
