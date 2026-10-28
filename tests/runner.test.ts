import { describe, expect, it } from 'vitest'
import { claudeArgs, permissionArgs } from '../worker/runner'

describe('claudeArgs', () => {
  it('usa sempre Opus, lo stream JSON e solo il server MCP di Marketer', () => {
    const args = claudeArgs({ id: 7, title: 'Prova', permission: 'read' }, '/tmp/job-7.mcp.json')
    expect(args.slice(0, 3)).toEqual(['-p', '--model', 'opus'])
    expect(args).toContain('--strict-mcp-config')
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json')
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('/tmp/job-7.mcp.json')
  })
})

describe('permissionArgs', () => {
  it('in sola lettura non permette modifiche né comandi', () => {
    const tools = permissionArgs('read').at(-1)!
    expect(tools).toContain('Read')
    expect(tools).not.toMatch(/Edit|Write|Bash/)
  })

  it('in modifica aggiunge Edit e Write ma non Bash', () => {
    const tools = permissionArgs('edit').at(-1)!
    expect(tools).toMatch(/Edit/)
    expect(tools).not.toMatch(/Bash/)
  })
})
