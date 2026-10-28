import { useDb } from '../../db/client'
import { createSegment } from '../../lib/prospects'

export default defineEventHandler(async (event) => {
  try {
    return createSegment(useDb(), await readBody(event))
  }
  catch (err) {
    toHttpError(err)
  }
})
