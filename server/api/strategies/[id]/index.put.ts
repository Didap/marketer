import { useDb } from '../../../db/client'
import { editStrategy } from '../../../lib/strategies'

export default defineEventHandler(async (event) => {
  try {
    return editStrategy(useDb(), idParam(event), await readBody(event))
  }
  catch (err) {
    toHttpError(err)
  }
})
