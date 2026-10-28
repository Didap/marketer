import { useDb } from '../../../db/client'
import { getSegment, listSearches } from '../../../lib/prospects'
import { sourcesAvailable } from '../../../lib/sources'

export default defineEventHandler((event) => {
  try {
    const db = useDb()
    const id = idParam(event)
    return { segment: getSegment(db, id), searches: listSearches(db, id), sources: sourcesAvailable() }
  }
  catch (err) {
    toHttpError(err)
  }
})
