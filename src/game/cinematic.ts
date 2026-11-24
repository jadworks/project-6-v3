export function playMissionCard(title: string): void {
  document.querySelector('.mission-cinematic')?.remove()
  const card = document.createElement('div')
  card.className = 'mission-cinematic'
  const label = document.createElement('small'); label.textContent = 'CONTRACT ACCEPTED'
  const name = document.createElement('strong'); name.textContent = title
  card.append(label, name)
  Object.assign(card.style, { position: 'fixed', left: '0', top: '34%', width: '100%', zIndex: '40', pointerEvents: 'none', textAlign: 'center', fontFamily: 'system-ui,sans-serif', textShadow: '0 3px 15px #000', transition: 'opacity .7s' })
  Object.assign(label.style, { display: 'block', color: '#ffe45b', fontSize: '12px', fontWeight: '800', letterSpacing: '.3em' })
  Object.assign(name.style, { display: 'block', color: '#fff', fontSize: 'clamp(30px,5vw,70px)', fontStyle: 'italic', fontWeight: '1000', letterSpacing: '-.03em' })
  document.body.append(card)
  window.setTimeout(() => { card.style.opacity = '0' }, 1800)
  window.setTimeout(() => card.remove(), 2600)
}
