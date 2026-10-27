// A small canvas confetti burst with no dependencies: two "cannons" firing up from the
// bottom corners, plus a short rain of pieces from the top. Pieces tumble, drift and fade.
// Returns a function that stops it and clears the canvas.
const COLORS = ['#3867f4', '#16a34a', '#ffb648', '#ef4444', '#9333ea', '#06b6d4', '#f472b6']
const GRAVITY = 0.32
const DRAG = 0.992
const RAIN_MS = 2200
const MAX_MS = 6500

export function launchConfetti(canvas) {
  const ctx = canvas.getContext('2d')
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const width = window.innerWidth
  const height = window.innerHeight
  canvas.width = width * ratio
  canvas.height = height * ratio
  ctx.scale(ratio, ratio)

  const pieces = []
  const random = (min, max) => min + Math.random() * (max - min)

  function addPiece(x, y, angle, speed) {
    pieces.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: random(6, 12),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      round: Math.random() < 0.25,
      rotation: random(0, Math.PI * 2),
      spin: random(-0.25, 0.25),
      wobble: random(0, Math.PI * 2),
      life: 0,
    })
  }

  // Cannons: a fan of pieces aimed up and inward from each bottom corner.
  const mobile = width < 600
  const cannonCount = mobile ? 55 : 90
  for (let index = 0; index < cannonCount; index++) {
    addPiece(0, height, -random(0.45, 1.25), random(14, mobile ? 22 : 30))
    addPiece(width, height, -Math.PI + random(0.45, 1.25), random(14, mobile ? 22 : 30))
  }

  const startedAt = performance.now()
  let lastRain = startedAt
  let frame = 0
  let stopped = false

  function tick(now) {
    if (stopped) return
    const elapsed = now - startedAt
    ctx.clearRect(0, 0, width, height)

    // Rain from the top edge for the first couple of seconds.
    if (elapsed < RAIN_MS && now - lastRain > 40) {
      lastRain = now
      for (let index = 0; index < (mobile ? 2 : 4); index++) addPiece(random(0, width), -12, Math.PI / 2 + random(-0.4, 0.4), random(2, 5))
    }

    for (let index = pieces.length - 1; index >= 0; index--) {
      const piece = pieces[index]
      piece.life += 1
      piece.vx *= DRAG
      piece.vy = piece.vy * DRAG + GRAVITY
      piece.wobble += 0.12
      piece.x += piece.vx + Math.sin(piece.wobble) * 0.6
      piece.y += piece.vy
      piece.rotation += piece.spin

      if (piece.y > height + 30) {
        pieces.splice(index, 1)
        continue
      }
      // Fade the tail end of the run so it doesn't cut off.
      const fade = elapsed > MAX_MS - 1200 ? Math.max(0, (MAX_MS - elapsed) / 1200) : 1
      ctx.save()
      ctx.globalAlpha = fade
      ctx.translate(piece.x, piece.y)
      ctx.rotate(piece.rotation)
      ctx.fillStyle = piece.color
      if (piece.round) {
        ctx.beginPath()
        ctx.arc(0, 0, piece.size / 2.4, 0, Math.PI * 2)
        ctx.fill()
      } else {
        // The width flips with the wobble so a piece looks like it is turning in 3D.
        ctx.fillRect(-piece.size / 2, -piece.size / 4, piece.size, (piece.size / 2) * Math.abs(Math.cos(piece.wobble)) + 1)
      }
      ctx.restore()
    }

    if (elapsed < MAX_MS && (pieces.length || elapsed < RAIN_MS)) frame = requestAnimationFrame(tick)
    else ctx.clearRect(0, 0, width, height)
  }

  frame = requestAnimationFrame(tick)

  return function stop() {
    stopped = true
    cancelAnimationFrame(frame)
    ctx.clearRect(0, 0, width, height)
  }
}
