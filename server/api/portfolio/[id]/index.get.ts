import { inArray } from 'drizzle-orm'
import { useDb } from '../../../db/client'
import { portfolioItems } from '../../../db/schema'
import { getPortfolioItem } from '../../../lib/portfolio'

export default defineEventHandler((event) => {
  try {
    const db = useDb()
    const item = getPortfolioItem(db, idParam(event))
    const related = item.related.length
      ? db.select({ id: portfolioItems.id, slug: portfolioItems.slug, name: portfolioItems.name, kind: portfolioItems.kind })
          .from(portfolioItems).where(inArray(portfolioItems.slug, item.related)).all()
      : []
    return { item, related }
  }
  catch (err) {
    toHttpError(err)
  }
})
