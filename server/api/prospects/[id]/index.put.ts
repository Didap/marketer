import { useDb } from '../../../db/client'
import { updateProspect } from '../../../lib/prospects'

export default defineEventHandler(async (event) => {
  try {
    return updateProspect(useDb(), idParam(event), await readBody(event))
  }
  catch (err) {
    toHttpError(err)
  }
})
