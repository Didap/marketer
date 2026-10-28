import { useDb } from '../../../db/client'
import { updateSegment } from '../../../lib/prospects'

export default defineEventHandler(async (event) => {
  try {
    return updateSegment(useDb(), idParam(event), await readBody(event))
  }
  catch (err) {
    toHttpError(err)
  }
})
