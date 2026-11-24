import './gameHud.css'

export type HudState = {
  money: number
  health: number
  ammo: number
  wanted: number
  speed: number
  district: string
  objective: string
  time: string
  inVehicle: boolean
  x: number
  z: number
  heading: number
  prompt: string
  weather: string
  target: { x: number; z: number } | null
  safehouses: { x: number; z: number }[]
}

export type HudCallbacks = {
  start: () => void
  resume: () => void
  map: () => void
  audio: () => void
  weather: () => void
  mission: (id: string) => void
  quit: () => void
  leaderboard: () => Promise<string>
  retryLeaderboard: () => Promise<string>
}

type View = 'title' | 'game' | 'pause' | 'map' | 'controls' | 'missions' | 'leaderboard'
type ReturnView = 'title' | 'game' | 'pause'

const icons = {
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M14 6l6 6-6 6"/></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20S4 15 4 9.5a4.5 4.5 0 0 1 8-2.8 4.5 4.5 0 0 1 8 2.8C20 15 12 20 12 20Z"/></svg>',
}

// A north-up schematic. World positions use the city's approximately 760-unit square bounds.
// The same map is used at both sizes, so district and player markers always agree.
const mapArt = (): string => `
  <svg class="vbn-map-art" viewBox="0 0 260 260" preserveAspectRatio="none" aria-hidden="true">
    <rect width="260" height="260" fill="#11232c"/>
    <path d="M0 0H260V260H0Z" fill="#173943"/>
    <path d="M0 0H173V260H0Z" fill="#293b3b"/>
    <path d="M0 0H57V260H0Z" fill="#314c3b"/>
    <path d="M157 0H173V260H157Z" fill="#887f68"/>
    <path d="M173 0V260" fill="none" stroke="#c1ad84" stroke-opacity=".8" stroke-width="2"/>
    <path d="M0 34H155M0 70H155M0 106H155M0 142H155M0 178H155M0 214H170M0 250H155M65 0V260M95 0V260M130 0V260M152.5 0V260" fill="none" stroke="#aab4a9" stroke-opacity=".46" stroke-width="4"/>
    <path d="M0 70H155M0 142H155M130 0V260M152.5 0V260" fill="none" stroke="#f7d687" stroke-opacity=".5" stroke-width="1" stroke-dasharray="3 4"/>
    <path d="M70 40h20v23H70zm30 0h25v23h-25zm35 0h12v23h-12zM70 76h20v23H70zm30 0h25v23h-25zm35 0h12v23h-12zM70 112h20v23H70zm30 0h25v23h-25zm35 0h12v23h-12zM70 148h20v23H70zm30 0h25v23h-25zm35 0h12v23h-12zM70 184h20v23H70zm30 0h25v23h-25zm35 0h12v23h-12zM70 220h20v23H70zm30 0h25v23h-25zm35 0h12v23h-12z" fill="#415652" fill-opacity=".8"/>
    <path d="M236 19v15m-7-7h15" stroke="#e7f6ee" stroke-width="1.3"/>
    <text x="232" y="16" fill="#e7f6ee" font-size="9" font-family="sans-serif" font-weight="bold">N</text>
  </svg>
  <span class="vbn-map-marker vbn-marker-beach" title="Vice Beach"><i></i></span>
  <span class="vbn-map-marker vbn-marker-downtown" title="Downtown"><i></i></span>
  <span class="vbn-map-marker vbn-marker-port" title="Port Vice"><i></i></span>
  <span class="vbn-map-marker vbn-marker-wetlands" title="The Wetlands"><i></i></span>
  <span class="vbn-map-homes"></span>
  <span class="vbn-map-target" title="Current objective" hidden></span>
  <span class="vbn-map-player" aria-label="Your position"><i></i></span>`

const controls = [
  ['W A S D', 'Move / drive'],
  ['MOUSE', 'Look / aim'],
  ['SHIFT', 'Sprint'],
  ['SPACE', 'Jump / handbrake'],
  ['F', 'Enter / exit vehicle'],
  ['E', 'Interact'],
  ['C', 'Crouch'],
  ['CLICK', 'Fire'],
  ['R', 'Reload'],
  ['M', 'City map'],
  ['T', 'Change weather'],
  ['ESC', 'Pause'],
]

const missions = [
  { id: 'intro', number: '01', title: 'WELCOME TO VICE BAY', description: 'Find your way from the neon strip to the downtown plaza.', tag: 'THE INTRODUCTION' },
  { id: 'race', number: '02', title: 'MIDNIGHT RUN', description: 'Drive the checkpoints from the waterfront back to the strip.', tag: 'STREET RACE' },
  { id: 'delivery', number: '03', title: 'DOCKSIDE DELIVERY', description: 'Pick up a package at the port and take it to the western safehouse.', tag: 'DELIVERY' },
  { id: 'stunt', number: '04', title: 'STUNT DRIVER', description: 'Get behind the wheel and hit the stunt zone at speed.', tag: 'STUNT' },
]

/** DOM overlay for the game. The host owns simulation, pointer lock and input. */
export class GameHud {
  private readonly element: HTMLElement
  private view: View = 'title'
  private returnView: ReturnView = 'title'
  private toastTimer: number | undefined

  constructor(root: HTMLElement, private readonly callbacks: HudCallbacks) {
    this.element = document.createElement('div')
    this.element.className = 'vbn'
    this.element.innerHTML = this.template()
    this.element.querySelector('.vbn-map-legend')?.insertAdjacentHTML('beforeend', '<p class="vbn-map-symbol-key">◆ OBJECTIVE &nbsp; · &nbsp; ■ SAFEHOUSE</p>')
    root.replaceChildren(this.element)
    this.element.addEventListener('click', event => this.onClick(event))
    this.showTitle()
  }

  showTitle(): void { this.setView('title') }
  showGame(): void { this.setView('game') }
  showPause(): void { this.setView('pause') }
  showMap(): void {
    if (this.view !== 'map') this.returnView = this.baseView()
    this.setView('map')
  }
  showControls(): void {
    if (this.view !== 'controls') this.returnView = this.baseView()
    this.setView('controls')
  }

  update(state: HudState): void {
    const number = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback
    const health = Math.max(0, Math.min(100, number(state.health)))
    const wanted = Math.max(0, Math.min(5, Math.floor(number(state.wanted))))
    this.text('money', `$${Math.max(0, Math.floor(number(state.money))).toLocaleString('en-US')}`)
    this.text('health', `${Math.round(health)}`)
    this.text('ammo', `${Math.max(0, Math.floor(number(state.ammo)))}`)
    this.text('district', state.district || 'VICE BAY')
    this.text('objective', state.objective || 'Explore Vice Bay')
    this.text('time', state.time || '--:--')
    this.text('weather', state.weather || 'CLEAR')
    this.text('mode', state.inVehicle ? 'IN VEHICLE' : 'ON FOOT')
    this.text('speed', `${Math.round(Math.abs(number(state.speed)))}`)
    this.text('prompt', state.prompt || '')
    this.element.querySelectorAll<HTMLElement>('[data-health-fill]').forEach(el => { el.style.width = `${health}%` })
    this.element.querySelectorAll<HTMLElement>('[data-wanted-segment]').forEach((el, i) => { el.classList.toggle('is-lit', i < wanted); el.dataset.level = String(wanted) })
    this.element.querySelectorAll<HTMLElement>('[data-wanted]').forEach(el => el.setAttribute('aria-label', `Wanted level: ${wanted} out of 5`))
    this.element.querySelectorAll<HTMLElement>('[data-vehicle-only]').forEach(el => { el.hidden = !state.inVehicle })
    this.element.querySelectorAll<HTMLElement>('[data-prompt-wrap]').forEach(el => { el.hidden = !state.prompt })
    // x grows east and z grows south. Heading is supplied in radians.
    const x = Math.max(3, Math.min(97, (number(state.x) + 380) / 760 * 100))
    const z = Math.max(3, Math.min(97, (number(state.z) + 380) / 760 * 100))
    this.element.querySelectorAll<HTMLElement>('.vbn-map-player').forEach(el => {
      el.style.left = `${x}%`
      el.style.top = `${z}%`
      el.style.setProperty('--heading', `${-number(state.heading)}rad`)
    })
    const place = (el: HTMLElement, point: { x: number; z: number }): void => {
      el.style.left = `${Math.max(3, Math.min(97, (number(point.x) + 380) / 760 * 100))}%`
      el.style.top = `${Math.max(3, Math.min(97, (number(point.z) + 380) / 760 * 100))}%`
    }
    this.element.querySelectorAll<HTMLElement>('.vbn-map-target').forEach(el => {
      el.hidden = !state.target
      if (state.target) place(el, state.target)
    })
    this.element.querySelectorAll<HTMLElement>('.vbn-map-homes').forEach(container => {
      while (container.children.length < state.safehouses.length) {
        const marker = document.createElement('i')
        marker.className = 'vbn-map-home'
        marker.title = 'Safehouse'
        container.append(marker)
      }
      while (container.children.length > state.safehouses.length) container.lastElementChild?.remove()
      state.safehouses.forEach((home, index) => place(container.children[index] as HTMLElement, home))
    })
  }

  toast(message: string): void {
    const el = this.element.querySelector<HTMLElement>('.vbn-toast')
    if (!el) return
    el.textContent = message
    el.classList.toggle('is-visible', Boolean(message))
    if (this.toastTimer !== undefined) window.clearTimeout(this.toastTimer)
    if (message) this.toastTimer = window.setTimeout(() => el.classList.remove('is-visible'), 3200)
  }

  private async refreshLeaderboard(): Promise<void> {
    this.text('leaderboard', 'Loading scores…')
    try { this.text('leaderboard', await this.callbacks.leaderboard()) }
    catch { this.text('leaderboard', 'Leaderboard unavailable. Local play is unaffected.') }
  }

  private async retryLeaderboard(): Promise<void> {
    this.text('board-status', 'Retrying submission…')
    try { this.text('board-status', await this.callbacks.retryLeaderboard()) }
    catch { this.text('board-status', 'Retry failed. Local play is unaffected.') }
    await this.refreshLeaderboard()
  }

  private text(slot: string, value: string): void {
    this.element.querySelectorAll<HTMLElement>(`[data-value="${slot}"]`).forEach(el => {
      if (el.textContent !== value) el.textContent = value
    })
  }

  private baseView(): ReturnView {
    if (this.view === 'title') return 'title'
    if (this.view === 'pause') return 'pause'
    if (this.view === 'game') return 'game'
    return this.returnView
  }

  private setView(view: View): void {
    this.view = view
    this.element.dataset.view = view
    this.element.querySelectorAll<HTMLElement>('[data-view-panel]').forEach(panel => {
      const name = panel.dataset.viewPanel
      const active = name === view || (name === 'game' && (view === 'pause' || view === 'map' || ((view === 'controls' || view === 'missions' || view === 'leaderboard') && this.returnView !== 'title')))
      panel.hidden = !active
    })
  }

  private goBack(): void {
    if (this.returnView === 'game' && this.view === 'map') {
      this.callbacks.resume()
      this.showGame()
    } else {
      this.setView(this.returnView)
    }
  }

  private onClick(event: MouseEvent): void {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]')
    if (!button || !this.element.contains(button)) return
    switch (button.dataset.action) {
      case 'start': this.callbacks.start(); break
      case 'resume': this.callbacks.resume(); this.showGame(); break
      case 'pause':
        // There is no pause callback in the public API: route the button through the game's
        // existing Escape binding, which pauses the simulation and releases pointer lock.
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }))
        break
      case 'map': this.callbacks.map(); this.showMap(); break
      case 'controls': this.showControls(); break
      case 'missions': this.returnView = this.baseView(); this.setView('missions'); break
      case 'leaderboard': this.returnView = this.baseView(); this.setView('leaderboard'); this.text('board-status', ''); void this.refreshLeaderboard(); break
      case 'refresh-board': void this.refreshLeaderboard(); break
      case 'retry-board': void this.retryLeaderboard(); break
      case 'back': this.goBack(); break
      case 'audio': this.callbacks.audio(); break
      case 'weather': this.callbacks.weather(); break
      case 'quit': this.callbacks.quit(); this.showTitle(); break
      case 'mission': {
        const id = button.dataset.mission
        if (id) this.callbacks.mission(id)
        break
      }
    }
  }

  private template(): string {
    const key = (name: string, action: string) => `<div class="vbn-key-row"><kbd>${name}</kbd><span>${action}</span></div>`
    return `
      <section class="vbn-title" data-view-panel="title" aria-label="Vice Bay Nights main menu">
        <div class="vbn-title-shade"></div>
        <header class="vbn-title-top"><div class="vbn-top-brand"><span class="vbn-mark">V<span>B</span></span><span>VICE BAY<br><small>NIGHTS</small></span></div><div class="vbn-top-right"><span class="vbn-live-dot"></span> THE CITY IS AWAKE <span class="vbn-top-divider"></span> <span>EST. AFTER DARK</span></div></header>
        <div class="vbn-title-content">
          <div class="vbn-eyebrow"><span class="vbn-yellow-line"></span> THE CITY NEVER SLEEPS <span class="vbn-yellow-line short"></span></div>
          <h1 class="vbn-logo"><span>VICE BAY</span><em>Nights</em></h1>
          <div class="vbn-title-caption"><span class="vbn-caption-line"></span><span>WELCOME TO THE OTHER SIDE OF PARADISE.</span></div>
          <nav class="vbn-title-menu" aria-label="Main menu">
            <button type="button" class="vbn-btn vbn-btn-primary" data-action="start"><span><small>01 / LET'S RIDE</small><strong>START CAMPAIGN</strong></span>${icons.arrow}</button>
            <button type="button" class="vbn-btn vbn-btn-secondary" data-action="missions"><span><small>02 / PICK YOUR STORY</small><strong>MISSION SELECT</strong></span>${icons.arrow}</button>
            <button type="button" class="vbn-btn vbn-btn-secondary" data-action="controls"><span><small>03 / KNOW THE STREETS</small><strong>CONTROLS</strong></span>${icons.arrow}</button>
            <button type="button" class="vbn-title-board" data-action="leaderboard">ONLINE LEADERBOARD <span>↗</span></button>
          </nav>
        </div>
        <aside class="vbn-title-side" aria-hidden="true"><span>VICE BAY, USA</span><i></i><span>AFTER HOURS</span></aside>
        <footer class="vbn-title-bottom"><div class="vbn-mini-controls"><span><kbd>W A S D</kbd> MOVE</span><span><kbd>F</kbd> VEHICLE</span><span><kbd>M</kbd> MAP</span><span><kbd>ESC</kbd> PAUSE</span></div><div class="vbn-bottom-tag"><span class="vbn-live-dot"></span> YOUR NIGHT STARTS HERE</div></footer>
      </section>

      <section class="vbn-game" data-view-panel="game" aria-label="Game status" hidden><div class="vbn-camera-grade" aria-hidden="true"></div>
        <div class="vbn-game-top-left">
          <div class="vbn-hud-kicker"><span class="vbn-live-dot"></span> VICE BAY <b>/</b> <span data-value="district">VICE BAY</span></div>
          <div class="vbn-objective"><span class="vbn-objective-icon">${icons.target}</span><div><small>CURRENT OBJECTIVE</small><strong data-value="objective">Explore Vice Bay</strong></div></div>
          <div class="vbn-world-meta"><span data-value="time">--:--</span><i></i><span data-value="weather">CLEAR</span><i></i><span data-value="mode">ON FOOT</span></div>
        </div>
        <div class="vbn-game-top-right">
          <div class="vbn-money"><small>CASH ON HAND</small><strong data-value="money">$0</strong></div>
          <div class="vbn-stars" data-wanted aria-label="Wanted level: 0 out of 5">${Array.from({ length: 5 }, (_, i) => `<span class="vbn-wanted-segment" data-wanted-segment="${i + 1}" aria-hidden="true"><i></i></span>`).join('')}</div>
          <div class="vbn-vitals"><span class="vbn-vital-icon">${icons.heart}</span><div class="vbn-health"><div><small>HEALTH</small><b data-value="health">100</b></div><span class="vbn-health-track"><i data-health-fill></i></span></div><div class="vbn-ammo"><small>WEAPON / AMMO</small><strong data-value="ammo">0</strong></div></div>
        </div>
        <div class="vbn-game-bottom-left">
          <div class="vbn-minimap-frame"><div class="vbn-minimap">${mapArt()}</div><span class="vbn-map-corner">N</span></div>
          <div class="vbn-map-caption"><div><small>CURRENT DISTRICT</small><strong data-value="district">VICE BAY</strong></div><button class="vbn-icon-btn" type="button" data-action="map" aria-label="Open city map">${icons.map}</button></div>
        </div>
        <div class="vbn-prompt" data-prompt-wrap hidden><span class="vbn-prompt-accent"></span><span data-value="prompt"></span></div>
        <div class="vbn-game-bottom-right"><div class="vbn-speed" data-vehicle-only hidden><strong data-value="speed">0</strong><span>SPEED</span></div><button class="vbn-hud-pause" type="button" data-action="pause">${icons.pause}<span>PAUSE <kbd>ESC</kbd></span></button></div>
      </section>

      <section class="vbn-overlay" data-view-panel="pause" aria-label="Pause menu" hidden>
        <div class="vbn-modal vbn-pause-modal"><div class="vbn-modal-top"><span>VICE BAY NIGHTS <b>/</b> PAUSE MENU</span><span class="vbn-modal-index">01 — 04</span></div><p class="vbn-section-label">TAKE A BREATH</p><h2>PAUSED<span>.</span></h2><p class="vbn-modal-copy">The city can wait. For a moment.</p><nav class="vbn-modal-menu" aria-label="Pause options"><button type="button" class="vbn-btn vbn-btn-primary" data-action="resume"><span><strong>RESUME GAME</strong></span>${icons.arrow}</button><button type="button" class="vbn-menu-row" data-action="map"><span>CITY MAP</span><span>↗</span></button><button type="button" class="vbn-menu-row" data-action="missions"><span>MISSION SELECT</span><span>↗</span></button><button type="button" class="vbn-menu-row" data-action="leaderboard"><span>ONLINE LEADERBOARD</span><span>↗</span></button><button type="button" class="vbn-menu-row" data-action="controls"><span>CONTROLS</span><span>↗</span></button><button type="button" class="vbn-menu-row" data-action="audio"><span>TOGGLE AUDIO</span><span>↗</span></button><button type="button" class="vbn-menu-row" data-action="weather"><span>CHANGE WEATHER</span><span>↗</span></button><button type="button" class="vbn-menu-row vbn-quit" data-action="quit"><span>RETURN TO TITLE</span><span>↗</span></button></nav><div class="vbn-modal-foot">THE NIGHT IS STILL YOUNG <span>✦</span></div></div>
      </section>

      <section class="vbn-overlay" data-view-panel="leaderboard" aria-label="Online leaderboard" hidden>
        <div class="vbn-modal vbn-wide-modal"><div class="vbn-modal-top"><span>VICE BAY NIGHTS <b>/</b> ONLINE</span><button class="vbn-close" data-action="back" type="button" aria-label="Back">${icons.close}</button></div><p class="vbn-section-label">THE CITY'S CONTRACTS</p><h2>LEADER<span>BOARD.</span></h2><p class="vbn-modal-copy">Casual, client-reported rankings by contracts completed in a session. Guest scores are tied to this browser.</p><div class="vbn-board-list" data-value="leaderboard" role="status" aria-live="polite">Loading scores…</div><p class="vbn-board-status" data-value="board-status" role="status" aria-live="polite"></p><div class="vbn-board-actions"><button class="vbn-menu-row" type="button" data-action="refresh-board">REFRESH SCORES ↗</button><button class="vbn-menu-row" type="button" data-action="retry-board">RETRY FAILED SUBMISSION ↗</button></div><button class="vbn-back" type="button" data-action="back">← &nbsp; BACK</button></div>
      </section>

      <section class="vbn-overlay" data-view-panel="missions" aria-label="Mission selection" hidden>
        <div class="vbn-modal vbn-wide-modal"><div class="vbn-modal-top"><span>VICE BAY NIGHTS <b>/</b> CONTRACTS</span><button class="vbn-close" data-action="back" type="button" aria-label="Back">${icons.close}</button></div><p class="vbn-section-label">MAKE YOUR MOVE</p><h2>MISSION <span>SELECT.</span></h2><p class="vbn-modal-copy">Pick a story and take it to the streets.</p><div class="vbn-missions">${missions.map(mission => `<button type="button" class="vbn-mission" data-action="mission" data-mission="${mission.id}"><span class="vbn-mission-no">${mission.number}</span><span class="vbn-mission-main"><small>${mission.tag}</small><strong>${mission.title}</strong><span>${mission.description}</span></span><span class="vbn-mission-arrow">↗</span></button>`).join('')}</div><button class="vbn-back" type="button" data-action="back">← &nbsp; BACK</button></div>
      </section>

      <section class="vbn-overlay" data-view-panel="controls" aria-label="Controls" hidden>
        <div class="vbn-modal vbn-wide-modal"><div class="vbn-modal-top"><span>VICE BAY NIGHTS <b>/</b> FIELD GUIDE</span><button class="vbn-close" data-action="back" type="button" aria-label="Back">${icons.close}</button></div><p class="vbn-section-label">KNOW THE STREETS</p><h2>THE <span>CONTROLS.</span></h2><p class="vbn-modal-copy">Everything you need for a night out in Vice Bay.</p><div class="vbn-control-grid">${controls.map(([name, action]) => key(name, action)).join('')}</div><button class="vbn-back" type="button" data-action="back">← &nbsp; BACK</button></div>
      </section>

      <section class="vbn-overlay vbn-map-overlay" data-view-panel="map" aria-label="City map" hidden>
        <div class="vbn-modal vbn-map-modal"><div class="vbn-modal-top"><span>VICE BAY NIGHTS <b>/</b> CITY DIRECTORY</span><button class="vbn-close" data-action="back" type="button" aria-label="Close map">${icons.close}</button></div><div class="vbn-map-heading"><div><p class="vbn-section-label">FIND YOUR WAY</p><h2>VICE BAY <span>MAP.</span></h2></div><div class="vbn-map-heading-meta"><small>YOU ARE IN</small><strong data-value="district">VICE BAY</strong></div></div><div class="vbn-map-layout"><div class="vbn-full-map">${mapArt()}<span class="vbn-map-label vbn-map-label-beach">VICE BEACH</span><span class="vbn-map-label vbn-map-label-downtown">DOWNTOWN</span><span class="vbn-map-label vbn-map-label-port">PORT VICE</span><span class="vbn-map-label vbn-map-label-wetlands">THE WETLANDS</span></div><div class="vbn-map-legend"><p class="vbn-section-label">THE DISTRICTS</p><div><i class="vbn-dot pink"></i><span>01 <strong>VICE BEACH</strong><small>Beachfront / nightlife</small></span></div><div><i class="vbn-dot cyan"></i><span>02 <strong>DOWNTOWN</strong><small>City center / bank</small></span></div><div><i class="vbn-dot yellow"></i><span>03 <strong>PORT VICE</strong><small>Waterfront / warehouses</small></span></div><div><i class="vbn-dot green"></i><span>04 <strong>THE WETLANDS</strong><small>Outskirts / open roads</small></span></div><p class="vbn-legend-you"><i></i> YOUR POSITION</p></div></div><button class="vbn-back" type="button" data-action="back">← &nbsp; BACK</button></div>
      </section>
      <div class="vbn-toast" role="status" aria-live="polite"></div>`
  }
}
