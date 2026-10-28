import { useDb } from '../../../db/client'
import { enqueueSearch } from '../../../lib/prospects'

export default defineEventHandler((event) => {
  try {
    return enqueueSearch(useDb(), idParam(event)).map(s => ({ id: s.id, source: s.query.source }))
  }
  catch (err) {
    toHttpError(err)
  }
})
