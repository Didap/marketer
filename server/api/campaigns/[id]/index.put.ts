import { useDb } from '../../../db/client'
import { saveCampaign } from '../../../lib/outreach'

export default defineEventHandler(async (event) => {
  try {
    return saveCampaign(useDb(), idParam(event), await readBody(event))
  }
  catch (err) {
    toHttpError(err)
  }
})
