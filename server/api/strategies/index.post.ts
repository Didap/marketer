import { useDb } from '../../db/client'
import { enqueueStrategy, strategyWriteInput } from '../../lib/strategies'

export default defineEventHandler(async (event) => {
  try {
    const { prospectIds, title } = strategyWriteInput.parse(await readBody(event))
    return enqueueStrategy(useDb(), prospectIds, 'dashboard', { title })
  }
  catch (err) {
    toHttpError(err)
  }
})
