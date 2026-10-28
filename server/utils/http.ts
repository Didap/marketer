import type { H3Event } from 'h3'
import { ZodError } from 'zod'
import { JobError } from '../lib/jobs'
import { PortfolioError } from '../lib/portfolio'
import { OutreachError } from '../lib/outreach'
import { ProspectError } from '../lib/prospects'
import { StrategyError } from '../lib/strategies'

const JOB_ERROR_STATUS = { NOT_FOUND: 404, BAD_CWD: 400, NOT_CANCELABLE: 409 } as const
const PORTFOLIO_ERROR_STATUS = {
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  SLUG_TAKEN: 409,
  UNKNOWN_SOURCE: 400,
  NOTHING_TO_IMPORT: 409,
  IMPORT_RUNNING: 409,
  NO_PROPOSAL: 409,
} as const
const PROSPECT_ERROR_STATUS = {
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  SOURCE_OFF: 409,
  NO_QUERIES: 409,
  SEARCH_RUNNING: 409,
  NO_WEBSITE: 409,
  PROPOSAL_RUNNING: 409,
} as const

const OUTREACH_ERROR_STATUS = {
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  NOT_ALLOWED: 409,
  NOT_PENDING: 409,
  JOB_RUNNING: 409,
  NOTHING_TO_DO: 409,
} as const

const STRATEGY_ERROR_STATUS = { NOT_FOUND: 404, INVALID_INPUT: 400, BUSY: 409 } as const

/** Errori del dominio in risposte HTTP con il messaggio in chiaro per la dashboard. */
export function toHttpError(err: unknown): never {
  if (err instanceof JobError) {
    throw createError({ statusCode: JOB_ERROR_STATUS[err.code], statusMessage: err.code, message: err.message })
  }
  if (err instanceof PortfolioError) {
    throw createError({ statusCode: PORTFOLIO_ERROR_STATUS[err.code], statusMessage: err.code, message: err.message })
  }
  if (err instanceof ProspectError) {
    throw createError({ statusCode: PROSPECT_ERROR_STATUS[err.code], statusMessage: err.code, message: err.message })
  }
  if (err instanceof OutreachError) {
    throw createError({ statusCode: OUTREACH_ERROR_STATUS[err.code], statusMessage: err.code, message: err.message })
  }
  if (err instanceof StrategyError) {
    throw createError({ statusCode: STRATEGY_ERROR_STATUS[err.code], statusMessage: err.code, message: err.message })
  }
  if (err instanceof ZodError) {
    throw createError({
      statusCode: 400,
      statusMessage: 'INVALID_INPUT',
      message: err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
    })
  }
  throw err
}

export function idParam(event: H3Event): number {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'BAD_ID' })
  return id
}
