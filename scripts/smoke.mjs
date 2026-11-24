// Smoke test of the built Vice Bay game. All leaderboard traffic is intercepted locally;
// no test scores or guest accounts are written to the shared project database.
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const port = 4300 + Math.floor(Math.random() * 500)
const url = `http://127.0.0.1:${port}/`
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--config', 'scripts/manus-game-assets/vite.config.mjs', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' })
let browser
const timeout = setTimeout(() => { console.error('smoke: timed out'); server.kill(); process.exit(1) }, 180_000)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

try {
  let ready = false
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(url)).ok) { ready = true; break } } catch {}
    await sleep(250)
  }
  if (!ready) throw new Error('preview server did not start')
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.setDefaultTimeout(20_000)
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  let boardReads = 0, runs = 0, submissions = 0, scoreSaved = false
  const payloads = []
  await page.route('**/api/leaderboards/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const response = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (request.method() === 'POST' && path.endsWith('/guests')) return response(201, { token: 'mock-guest-token' })
    if (request.method() === 'POST' && path.endsWith('/runs')) { runs++; return response(201, { runId: '00000000-0000-4000-8000-000000000001' }) }
    if (request.method() === 'PUT' && path.includes('/runs/')) {
      submissions++; payloads.push(request.postDataJSON())
      if (submissions === 1) return response(503, { error: 'temporary_failure' })
      scoreSaved = true
      return response(200, { runId: '00000000-0000-4000-8000-000000000001', score: 1, accepted: true, trust: 'client_reported' })
    }
    if (request.method() === 'GET' && path.includes('/boards/')) {
      boardReads++
      if (boardReads === 1) return response(503, { error: 'temporary_failure' })
      return response(200, { namespace: 'production', boardId: 'completed-contracts-v1', rulesVersion: 'v1', trust: 'client_reported', entries: scoreSaved ? [{ playerId: 'mock', displayName: 'VICE PLAYER', score: 1, rank: 1, achievedAt: '2026-01-01T00:00:00Z' }] : [], myRank: null })
    }
    return response(500, { error: 'unexpected_mock_request' })
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(window.__game), null, { timeout: 60_000 })
  await page.locator('[data-view-panel="title"] [data-action="leaderboard"]').click()
  await page.waitForFunction(() => document.querySelector('[data-value="leaderboard"]')?.textContent?.includes('temporary_failure'))
  await page.locator('[data-action="refresh-board"]').click()
  await page.waitForFunction(() => document.querySelector('[data-value="leaderboard"]')?.textContent?.includes('No scores yet'))
  await page.locator('[data-view-panel="leaderboard"] [data-action="back"]').first().click()
  await page.locator('[data-view-panel="title"] [data-action="start"]').click()
  await page.waitForFunction(() => window.__game.game.mode === 'playing')
  await page.keyboard.press('f')
  await page.waitForFunction(() => Boolean(window.__game.game.vehicles.active), null, { timeout: 25_000 })
  const vehicleStart = await page.evaluate(() => { const p = window.__game.game.vehicles.active.root.position; return { x: p.x, z: p.z } })
  await page.keyboard.down('w')
  await page.waitForFunction(start => { const p = window.__game.game.vehicles.active?.root.position; return p && Math.hypot(p.x-start.x, p.z-start.z) > .5 }, vehicleStart, { timeout: 30_000 })
  await page.keyboard.up('w')
  await page.keyboard.down('Space'); await sleep(500); await page.keyboard.up('Space')
  await page.keyboard.press('f')
  await page.waitForFunction(() => !window.__game.game.vehicles.active)
  await sleep(300)
  const yAfterExit = await page.evaluate(() => window.__game.game.player.root.position.y)
  if (yAfterExit > 0.25) throw new Error(`handbrake caused an unintended jump after exit: y=${yAfterExit}`)
  const before = await page.evaluate(() => { const p = window.__game.game.player.root.position; return { x: p.x, z: p.z } })
  await page.keyboard.down('w')
  await page.waitForFunction(start => { const p = window.__game.game.player.root.position; return Math.hypot(p.x-start.x, p.z-start.z) > .3 }, before, { timeout: 30_000 })
  await page.keyboard.up('w')
  await page.keyboard.press('t')
  await page.waitForFunction(() => window.__game.game.save.weather === 'rain')
  await page.keyboard.press('m')
  await page.waitForFunction(() => window.__game.game.mode === 'map')
  if (await page.locator('[data-view-panel="map"] .vbn-map-home').count() !== 3) throw new Error('safehouses missing from world map')
  await page.locator('[data-view-panel="map"] [data-action="back"]').first().click()
  await page.waitForFunction(() => window.__game.game.mode === 'playing')
  await page.evaluate(() => document.querySelector('[data-view-panel="game"] [data-action="pause"]').click())
  await page.waitForFunction(() => window.__game.game.mode === 'pause')
  await page.locator('[data-view-panel="pause"] [data-action="missions"]').click()
  await page.locator('[data-view-panel="missions"] [data-mission="intro"]').click()
  await page.waitForFunction(() => window.__game.game.missions.current === 'intro')
  await page.waitForFunction(() => !document.querySelector('[data-view-panel="game"] .vbn-map-target').hidden)
  for (let i = 0; i < 60 && runs === 0; i++) await sleep(250)
  if (runs !== 1) throw new Error('mocked ranked run was not started')
  await page.evaluate(() => {
    const game = window.__game.game
    game.player.root.position.set(0, 0, -65); game.step(1 / 60)
    game.player.root.position.set(-55, 0, -125); game.step(1 / 60)
  })
  for (let i = 0; i < 60 && submissions === 0; i++) await sleep(250)
  if (submissions !== 1) throw new Error('mocked score submission was not attempted')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vicebay-nights.progress.v1')))
  if (!saved.completed.includes('intro') || saved.money < 4000 || saved.weather !== 'rain') throw new Error('mission or weather progress was not saved')
  await page.evaluate(() => document.querySelector('[data-view-panel="game"] [data-action="pause"]').click())
  await page.waitForFunction(() => window.__game.game.mode === 'pause')
  await page.locator('[data-view-panel="pause"] [data-action="leaderboard"]').click()
  await page.locator('[data-action="retry-board"]').click()
  await page.waitForFunction(() => document.querySelector('[data-value="board-status"]')?.textContent?.includes('score submitted'))
  await page.waitForFunction(() => document.querySelector('[data-value="leaderboard"]')?.textContent?.includes('VICE PLAYER'))
  if (submissions !== 2 || JSON.stringify(payloads[0]) !== JSON.stringify(payloads[1])) throw new Error('retry did not preserve the original score payload')
  if (errors.length) throw new Error(`browser errors: ${errors.join('; ')}`)
  console.log('smoke: OK — title, leaderboard error/retry, driving, walking, weather, map, mission and save')
} catch (error) {
  console.error(`smoke: FAIL — ${error?.stack ?? error}`)
  process.exitCode = 1
} finally {
  clearTimeout(timeout)
  await browser?.close().catch(() => {})
  server.kill('SIGTERM')
}
