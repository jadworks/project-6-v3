import { createLeaderboardClient, type RunTicket } from '../../leaderboard.js'

/** Casual client-reported scores; local contracts never depend on online availability. */
export class OnlineLeaderboard {
  private readonly client = createLeaderboardClient({ identity: 'guest', boardId: 'completed-contracts-v1', rulesVersion: 'v1' })
  private pending: Promise<RunTicket | null> | null = null
  private lastFailed: RunTicket | null = null
  private generation = 0
  private sessionCompletions = 0
  constructor(private readonly notify: (message: string) => void) {}

  begin(eligible: boolean): void {
    const generation = ++this.generation
    this.pending = eligible ? (async () => {
      const identity = await this.client.ensureGuest('VICE PLAYER')
      if (!identity.ok) { this.notify(`Leaderboard unavailable: ${identity.error}`); return null }
      const result = await this.client.beginRun()
      if (!result.ok) { this.notify(`Leaderboard unavailable: ${result.error}`); return null }
      return generation === this.generation ? result.value : null
    })() : null
  }
  async complete(seconds: number, eligible: boolean): Promise<void> {
    if (!eligible) return
    this.sessionCompletions++
    const score = this.sessionCompletions
    if (!this.pending) return
    const pending = this.pending; this.pending = null
    const ticket = await pending
    if (!ticket) return
    const result = await this.client.submitRun(ticket, score, Math.max(1000, Math.round(seconds * 1000)))
    if (!result.ok) { this.lastFailed = ticket; this.notify(`Leaderboard submission failed: ${result.error}`); return }
    if (this.lastFailed === ticket) this.lastFailed = null
    this.notify(result.value.leaderboard.ok ? 'Contract score submitted to the online leaderboard' : `Score saved; leaderboard refresh failed: ${result.value.leaderboard.error}`)
  }
  async retry(): Promise<string> {
    if (!this.lastFailed) return 'No leaderboard submission to retry.'
    const result = await this.client.retryRun(this.lastFailed)
    if (!result.ok) return `Leaderboard retry failed: ${result.error}`
    this.lastFailed = null
    return result.value.leaderboard.ok ? 'Leaderboard score submitted.' : `Score saved; leaderboard refresh failed: ${result.value.leaderboard.error}`
  }
  async list(): Promise<string> {
    const result = await this.client.list(10)
    if (!result.ok) return `Leaderboard unavailable: ${result.error}`
    if (!result.value.entries.length) return 'No scores yet. Complete contracts to set the first score.'
    return result.value.entries.map(entry => `${entry.rank}. ${entry.displayName} — ${entry.score} contracts`).join('\n')
  }
}
