import { useDb } from '../../../db/client'
import { getJob, isFinal, jobEventsAfter } from '../../../lib/jobs'

// Log del job in diretta (SSE). Il worker scrive in job_events, qui si legge cosa c'è di nuovo
// ogni mezzo secondo. Con Last-Event-ID il browser riprende da dove si era interrotto.

const POLL_MS = 500

export default defineEventHandler(async (event) => {
  const db = useDb()
  const id = idParam(event)
  try {
    getJob(db, id)
  }
  catch (err) {
    toHttpError(err)
  }

  let cursor = Number(getHeader(event, 'last-event-id') ?? getQuery(event).after ?? 0) || 0
  let lastJobState = ''
  let busy = false
  const stream = createEventStream(event)

  const pump = async () => {
    if (busy) return
    busy = true
    try {
      for (const ev of jobEventsAfter(db, id, cursor)) {
        cursor = ev.id
        await stream.push({ id: String(ev.id), event: 'ev', data: JSON.stringify(ev) })
      }
      const job = getJob(db, id)
      const { prompt: _prompt, ...rest } = job
      const state = JSON.stringify(rest)
      if (state !== lastJobState) {
        lastJobState = state
        await stream.push({ event: 'job', data: state })
      }
      if (isFinal(job) && jobEventsAfter(db, id, cursor, 1).length === 0) {
        await stream.push({ event: 'end', data: '{}' })
        clearInterval(timer)
        await stream.close()
      }
    }
    finally {
      busy = false
    }
  }

  const timer = setInterval(() => {
    pump().catch(() => clearInterval(timer))
  }, POLL_MS)
  stream.onClosed(async () => {
    clearInterval(timer)
    await stream.close()
  })
  setImmediate(() => pump().catch(() => clearInterval(timer)))
  return stream.send()
})
