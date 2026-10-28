import { useDb } from '../../db/client'
import { createPortfolioItem } from '../../lib/portfolio'

export default defineEventHandler(async (event) => {
  try {
    return createPortfolioItem(useDb(), await readBody(event))
  }
  catch (err) {
    toHttpError(err)
  }
})
