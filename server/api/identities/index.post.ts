import { useDb } from '../../db/client'
import { saveIdentity } from '../../lib/outreach'

export default defineEventHandler(async (event) => {
  try {
    return saveIdentity(useDb(), null, await readBody(event))
  }
  catch (err) {
    toHttpError(err)
  }
})
