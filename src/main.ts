import './styles/main.css'
import { Input } from './engine/input'
import { GameLoop } from './engine/loop'
import { Renderer } from './engine/renderer'
import { ViceAudio } from './engine/viceAudio'
import { ViceGame } from './game/viceGame'

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!
  const root = document.querySelector<HTMLElement>('#ui')!
  const renderer = new Renderer(canvas, 'medium')
  const input = new Input(canvas)
  const game = new ViceGame(renderer, input, new ViceAudio(), root)
  if (import.meta.env.DEV) {
    const [{ registerGameTuning }, { tuning }] = await Promise.all([import('../scripts/manus-tuning/adapter.js'), import('./game/tuning')])
    await registerGameTuning(tuning)
  }
  const loop = new GameLoop({ beforeFrame: dt => input.update(dt), step: dt => game.step(dt), render: (_alpha, dt) => game.render(dt) })
  canvas.addEventListener('click', () => { if (game.mode === 'playing') input.lockPointer() })
  loop.start()
  ;(window as unknown as { __game: unknown }).__game = { game, input }
}

boot().catch(error => {
  console.error(error)
  const root = document.querySelector<HTMLElement>('#ui')
  if (root) root.textContent = `Unable to start Vice Bay Nights: ${String(error)}`
})
