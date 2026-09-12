// Live chip occupancy. Each pulse slot contributes 1–3 so the ticker
// doesn't step in lockstep with the raw count. Same live input always
// paints the same number; one more slot adds at most 3.

function slotWeight(index: number): 1 | 2 | 3 {
  const mixed = Math.imul(index + 1, 2654435761) >>> 0
  return ((mixed % 3) + 1) as 1 | 2 | 3
}

export function presentLiveCount(live: number): number {
  if (!Number.isFinite(live) || live <= 0) return 0
  const n = Math.floor(live)
  let total = 0
  for (let i = 0; i < n; i++) total += slotWeight(i)
  return total
}
