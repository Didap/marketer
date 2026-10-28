import { telegramConfig } from '../lib/env'
import { legalMatrix } from '../lib/legal'

export default defineEventHandler(() => ({ matrix: legalMatrix(), telegram: telegramConfig() !== null }))
