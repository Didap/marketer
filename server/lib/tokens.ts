// Conto dei token per la guardia giornaliera.
//
// I token non pesano tutti uguale sul limite settimanale: una lettura dalla cache costa un
// decimo di un token di input, un token di output cinque volte tanto. Il «token pesato» usa i
// rapporti del listino Opus (input 1, scrittura cache 1,25, lettura cache 0,1, output 5),
// quindi è il costo del job espresso in token di input. Il tetto si tara su questo numero.

export interface Usage {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

export const EMPTY_USAGE: Usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }

export function weigh(u: Usage): number {
  return Math.round(u.input + u.cacheWrite * 1.25 + u.cacheRead * 0.1 + u.output * 5)
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheRead: a.cacheRead + b.cacheRead,
  }
}

/** Giorno di calendario a Roma, AAAA-MM-GG: il tetto si azzera a mezzanotte italiana. */
export function romeDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}
