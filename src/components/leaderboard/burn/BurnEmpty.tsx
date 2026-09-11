// The slab's empty state — a flame, a tracked title, one line of body
// and, when the viewer can do something about it, a single ember action
// in the toolbar's cell register.

import { IconFlame } from '@/components/leaderboard/icons'

export function BurnEmpty({
  title,
  body,
  action
}: {
  title: string
  body: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="bb-empty">
      <IconFlame size={24} className="bb-ember" />
      <p className="bb-empty-title">{title}</p>
      <p className="bb-empty-body">{body}</p>
      {action && (
        <div className="bb-seg bb-empty-action">
          <button type="button" className="bb-segbtn" data-ember onClick={action.onClick}>
            {action.label}
          </button>
        </div>
      )}
    </div>
  )
}
