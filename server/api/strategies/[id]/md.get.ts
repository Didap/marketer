import { useDb } from '../../../db/client'
import { slugify } from '../../../lib/portfolio'
import { getStrategy, strategyMarkdown, strategyTargets } from '../../../lib/strategies'

/** La strategia come file .md da scaricare. */
export default defineEventHandler((event) => {
  try {
    const db = useDb()
    const strategy = getStrategy(db, idParam(event))
    setHeader(event, 'content-type', 'text/markdown; charset=utf-8')
    setHeader(event, 'content-disposition', `attachment; filename="strategia-${slugify(strategy.title) || strategy.id}.md"`)
    return strategyMarkdown(strategy, strategyTargets(db, strategy))
  }
  catch (err) {
    toHttpError(err)
  }
})
