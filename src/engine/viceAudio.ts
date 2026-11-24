export class ViceAudio {
  private context?: AudioContext
  private master?: GainNode
  private engine?: OscillatorNode
  private engineGain?: GainNode
  private siren?: OscillatorNode
  private sirenGain?: GainNode
  private nextBeat = 0
  private beat = 0
  muted = false

  unlock(): void {
    if (!this.context) {
      const c = new AudioContext(); this.context = c
      const master = c.createGain(); master.gain.value = this.muted ? 0 : .17; master.connect(c.destination); this.master = master
      const engine = c.createOscillator(), engineGain = c.createGain()
      engine.type = 'sawtooth'; engine.frequency.value = 55; engineGain.gain.value = 0
      engine.connect(engineGain).connect(master); engine.start(); this.engine = engine; this.engineGain = engineGain
      const siren = c.createOscillator(), sirenGain = c.createGain()
      siren.type = 'triangle'; siren.frequency.value = 660; sirenGain.gain.value = 0
      siren.connect(sirenGain).connect(master); siren.start(); this.siren = siren; this.sirenGain = sirenGain
      this.nextBeat = c.currentTime + .1
    }
    void this.context.resume()
  }
  toggle(): boolean {
    this.muted = !this.muted
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.muted ? 0 : .17, this.context.currentTime, .03)
    return this.muted
  }
  update(speed: number, inVehicle: boolean, wanted: number, playing: boolean): void {
    const c = this.context
    if (!c || !this.engine || !this.engineGain || !this.siren || !this.sirenGain) return
    const t = c.currentTime
    this.engine.frequency.setTargetAtTime(48 + Math.min(145, Math.abs(speed) * 3.3), t, .08)
    this.engineGain.gain.setTargetAtTime(playing && inVehicle ? .17 : 0, t, .12)
    this.siren.frequency.setTargetAtTime(620 + 220 * (.5 + .5 * Math.sin(t * 4)), t, .04)
    this.sirenGain.gain.setTargetAtTime(playing && wanted > 0 ? .045 : 0, t, .1)
    if (playing && t >= this.nextBeat) {
      this.nextBeat = t + .29
      const notes = [110, 0, 164.81, 0, 130.81, 0, 196, 0]
      if (notes[this.beat % notes.length]) this.note(notes[this.beat % notes.length], .13, .045)
      if (this.beat % 2 === 0) this.note(55, .09, .11)
      this.beat++
    }
  }
  private note(frequency: number, duration: number, volume: number): void {
    if (!this.context || !this.master) return
    const c = this.context, osc = c.createOscillator(), gain = c.createGain(), t = c.currentTime
    osc.type = 'triangle'; osc.frequency.setValueAtTime(frequency, t)
    gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(.001, t + duration)
    osc.connect(gain).connect(this.master); osc.start(t); osc.stop(t + duration)
  }
  shoot(): void {
    if (!this.context || !this.master) return
    const c = this.context, t = c.currentTime, n = Math.floor(c.sampleRate * .13), data = c.createBuffer(1, n, c.sampleRate)
    const channel = data.getChannelData(0)
    for (let i = 0; i < n; i++) channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 1.8)
    const src = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain()
    src.buffer = data; filter.type = 'lowpass'; filter.frequency.setValueAtTime(1800, t); filter.frequency.exponentialRampToValueAtTime(480, t + .12)
    gain.gain.setValueAtTime(.7, t); gain.gain.exponentialRampToValueAtTime(.001, t + .13)
    src.connect(filter).connect(gain).connect(this.master); src.start(t)
    const boom = c.createOscillator(), boomGain = c.createGain()
    boom.type = 'sine'; boom.frequency.setValueAtTime(115, t); boom.frequency.exponentialRampToValueAtTime(48, t + .16)
    boomGain.gain.setValueAtTime(.2, t); boomGain.gain.exponentialRampToValueAtTime(.001, t + .16)
    boom.connect(boomGain).connect(this.master); boom.start(t); boom.stop(t + .17)
  }
  robbery(): void {
    this.note(330, .12, .08); window.setTimeout(() => this.note(494, .16, .08), 70)
  }
  impact(): void { this.note(70, .16, .22) }
}
