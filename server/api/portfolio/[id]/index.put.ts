import { useDb } from '../../../db/client'
import { updatePortfolioItem } from '../../../lib/portfolio'

export default defineEventHandler(async (event) => {
  try {
    return updatePortfolioItem(useDb(), idParam(event), await readBody(event))
  }
  catch (err) {
    toHttpError(err)
  }
})
