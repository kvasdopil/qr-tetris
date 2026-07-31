import { create } from 'qrcode'

const QUIET_ZONE = 2 // modules of padding the spec requires around the code
const FINDER = 7 // the three corner markers: a 7x7 frame around a 3x3 dot

// Corner radii in modules, outermost first. The finder is drawn as three
// concentric shapes stepping in 1 module at a time, so each radius has to be 1
// less than the one outside it for the line to keep an even thickness.
const FINDER_RADII = [3, 2, 1]

// Everything else is cut into tetris parts: connected polyominoes of at most
// PART_SIZE modules, as few of them as possible so the big parts dominate.
const PART_SIZE = 4

const PART_RADIUS = 0.5
// On a part that bends, a convex corner with a long edge either side of it is the
// outside of the turn — the elbow of an L or an S. Those take a full module so
// the bend keeps an even width; every other corner stays at PART_RADIUS.
const ELBOW_RADIUS = 1
const LONG_EDGE = 2

// Gap between neighbouring parts, in modules. Each part is inset by half of it
// on every side, so two parts sharing an edge end up this far apart.
const PART_GAP = 0.2

// Diameter of a free-standing module, in modules. Nothing sits orthogonally
// next to one, so instead of being inset like every other part it grows past its
// own cell — the nearest dark module is a diagonal step away, which leaves room.
const LONE_DOT_SIZE = 1.1

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] // orthogonal only, no diagonals

const num = (n) => String(Math.round(n * 1000) / 1000)
const point = ([x, y]) => `${num(x)} ${num(y)}`
const key = ([x, y]) => `${x},${y}`
const cell = (k) => k.split(',').map(Number)

function roundedRect(x, y, side, radius) {
  const r = Math.min(radius, side / 2)
  const s = side - 2 * r
  const arc = `a${num(r)} ${num(r)} 0 0 1`
  return (
    `M${point([x + r, y])}` +
    `h${num(s)}${arc} ${num(r)} ${num(r)}` +
    `v${num(s)}${arc} ${num(-r)} ${num(r)}` +
    `h${num(-s)}${arc} ${num(-r)} ${num(-r)}` +
    `v${num(-s)}${arc} ${num(r)} ${num(-r)}z`
  )
}

// A marker as nested rounded squares, each one module further in than the last.
function marker(x, y, side, radii) {
  return radii.map((r, i) => roundedRect(x + i, y + i, side - 2 * i, r)).join('')
}

// A radius of half the side turns a rounded square into a circle.
function loneDot([x, y]) {
  const grown = (LONE_DOT_SIZE - 1) / 2
  return roundedRect(x - grown, y - grown, LONE_DOT_SIZE, LONE_DOT_SIZE / 2)
}

function neighboursOf(k) {
  const [x, y] = cell(k)
  return NEIGHBOURS.map(([dx, dy]) => `${x + dx},${y + dy}`)
}

// The connected run of `cells` reachable from `start`, capped at `limit` so a
// caller that only wants to know "is this smaller than a part?" can stop early.
function reachable(cells, start, limit = Infinity) {
  const found = new Set([start])
  const queue = [start]

  while (queue.length && found.size < limit) {
    for (const next of neighboursOf(queue.pop())) {
      if (cells.has(next) && !found.has(next)) {
        found.add(next)
        queue.push(next)
        if (found.size >= limit) break
      }
    }
  }

  return found
}

// Every connected subset of `cells` of exactly `size` modules that includes
// `anchor`. Grown one neighbour at a time and deduped by sorted key, which for
// four modules is a few hundred steps at most.
function candidateParts(cells, anchor, size) {
  const found = new Map()
  const stack = [[anchor]]

  while (stack.length) {
    const part = stack.pop()
    if (part.length === size) {
      found.set([...part].sort().join('|'), part)
      continue
    }
    for (const member of part) {
      for (const next of neighboursOf(member)) {
        if (cells.has(next) && !part.includes(next)) stack.push([...part, next])
      }
    }
  }

  return [...found.values()]
}

// Modules left with no neighbours once `part` is taken out. Cutting these loose
// forces a 1-module part later, so the fewer the better.
function orphansLeftBy(cells, part) {
  const taken = new Set(part)
  const stranded = new Set()

  for (const member of part) {
    for (const next of neighboursOf(member)) {
      if (!cells.has(next) || taken.has(next)) continue
      if (neighboursOf(next).every((n) => !cells.has(n) || taken.has(n))) stranded.add(next)
    }
  }

  return stranded.size
}

// Cut the dark modules into parts of at most PART_SIZE. Working from the first
// module in scan order, a run that already fits becomes a part outright;
// anything bigger gives up the 4-module subset that strands the fewest
// neighbours. That keeps the parts as large as possible — the count lands on or
// near the ceil(area / 4) floor.
function splitIntoParts(cells) {
  const remaining = new Set(cells)
  const parts = []

  while (remaining.size) {
    const anchor = remaining.keys().next().value
    const run = reachable(remaining, anchor, PART_SIZE + 1)

    let part
    if (run.size <= PART_SIZE) {
      part = [...run]
    } else {
      const candidates = candidateParts(remaining, anchor, PART_SIZE)
      part = candidates.reduce((best, candidate) =>
        orphansLeftBy(remaining, candidate) < orphansLeftBy(remaining, best) ? candidate : best
      )
    }

    for (const member of part) remaining.delete(member)
    parts.push(part.map(cell))
  }

  return parts
}

// Walk a part's boundary clockwise. Each module contributes the edges whose
// outside neighbour is empty, and those edges chain into one closed loop: at
// four modules a part can't enclose a hole or pinch at a vertex, so every
// vertex has exactly one outgoing edge.
function traceOutline(part) {
  const cells = new Set(part.map(key))
  const next = new Map()

  for (const [x, y] of part) {
    const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]
    const outside = [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]

    for (let i = 0; i < 4; i++) {
      if (cells.has(key(outside[i]))) continue
      next.set(key(corners[i]), corners[(i + 1) % 4])
    }
  }

  const start = next.keys().next().value
  const outline = []
  let at = start
  do {
    const vertex = next.get(at)
    outline.push(vertex)
    at = key(vertex)
  } while (at !== start && outline.length < next.size)

  return dropCollinear(outline)
}

function dropCollinear(outline) {
  const n = outline.length
  return outline.filter((curr, i) => {
    const prev = outline[(i - 1 + n) % n]
    const next = outline[(i + 1) % n]
    return (curr[0] - prev[0]) * (next[1] - curr[1]) !== (curr[1] - prev[1]) * (next[0] - curr[0])
  })
}

const span = (a, b) => Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1])
const direction = (from, to) => [Math.sign(to[0] - from[0]), Math.sign(to[1] - from[1])]
// The outline runs clockwise in SVG's y-down space, which puts the inside of the
// part a quarter turn to the left of every edge.
const inward = ([dx, dy]) => [-dy, dx]

// Pull every edge `by` modules towards the inside of the part. Two perpendicular
// offset edges meet at the vertex shifted along both their normals, which holds
// for concave corners too — there the notch simply opens up instead.
function insetOutline(outline, by) {
  const n = outline.length

  return outline.map((curr, i) => {
    const incoming = inward(direction(outline[(i - 1 + n) % n], curr))
    const outgoing = inward(direction(curr, outline[(i + 1) % n]))
    return [
      curr[0] + by * (incoming[0] + outgoing[0]),
      curr[1] + by * (incoming[1] + outgoing[1]),
    ]
  })
}

// Round every corner of a rectilinear outline: back off the vertex by r along
// the incoming edge, arc across to r along the outgoing one. Convex corners
// bulge out, concave ones scoop in, so the outline keeps its thickness. Corners
// are classified on the module grid but drawn on the inset outline, so the gap
// between parts doesn't change which corners count as elbows.
function roundedOutline(outline) {
  const n = outline.length
  const inset = insetOutline(outline, PART_GAP / 2)

  // In y-down space a positive cross product is a clockwise turn, which on a
  // clockwise outline means a convex corner.
  const convexAt = outline.map((curr, i) => {
    const incoming = direction(outline[(i - 1 + n) % n], curr)
    const outgoing = direction(curr, outline[(i + 1) % n])
    return incoming[0] * outgoing[1] - incoming[1] * outgoing[0] > 0
  })
  // No concave corner means the part is a solid rectangle with no bend to keep
  // even, so nothing earns the elbow radius — that leaves a 2x2 a rounded square
  // instead of swelling it into a circle.
  const bends = convexAt.includes(false)

  let d = ''

  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n
    const next = (i + 1) % n

    const incoming = direction(outline[prev], outline[i])
    const outgoing = direction(outline[i], outline[next])
    const convex = convexAt[i]
    const elbow =
      bends &&
      convex &&
      span(outline[prev], outline[i]) >= LONG_EDGE &&
      span(outline[i], outline[next]) >= LONG_EDGE

    const curr = inset[i]
    const r = Math.min(
      elbow ? ELBOW_RADIUS : PART_RADIUS,
      span(inset[prev], curr) / 2,
      span(curr, inset[next]) / 2
    )
    const from = [curr[0] - incoming[0] * r, curr[1] - incoming[1] * r]
    const to = [curr[0] + outgoing[0] * r, curr[1] + outgoing[1] * r]

    d += `${i === 0 ? 'M' : 'L'}${point(from)}A${num(r)} ${num(r)} 0 0 ${convex ? 1 : 0} ${point(to)}`
  }

  return `${d}z`
}

// Everything lands in one path, filled with fill-rule="evenodd": the finder's
// hole is enclosed twice so it drops out, and the dot inside it three times so
// it fills back in. Every other module — alignment pattern included — is cut
// into tetris parts.
function toPathData({ data, size }) {
  const markers = new Set()
  let d = ''

  const far = size - FINDER
  for (const [x, y] of [[0, 0], [far, 0], [0, far]]) {
    d += marker(x + QUIET_ZONE, y + QUIET_ZONE, FINDER, FINDER_RADII)
    for (let i = 0; i < FINDER; i++) {
      for (let j = 0; j < FINDER; j++) markers.add(`${x + j},${y + i}`)
    }
  }

  const cells = new Set()
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y * size + x] && !markers.has(`${x},${y}`)) {
        cells.add(`${x + QUIET_ZONE},${y + QUIET_ZONE}`)
      }
    }
  }

  const freeStanding = (module) => neighboursOf(key(module)).every((n) => !cells.has(n))

  for (const part of splitIntoParts(cells)) {
    const lone = part.length === 1 && freeStanding(part[0])
    d += lone ? loneDot(part[0]) : roundedOutline(traceOutline(part))
  }

  return d
}

// Encode `text` and lay it out as SVG geometry: `d` for a single path filled with
// fill-rule="evenodd", `side` for a square viewBox. Throws if the text is too
// long for a QR code.
export function qrPath(text) {
  const { modules } = create(text)

  return {
    d: toPathData(modules),
    side: modules.size + QUIET_ZONE * 2,
  }
}
