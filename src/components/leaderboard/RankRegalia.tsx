'use client'

// Rank regalia for the top-three standings rows. The champion wears a
// tilted floating crown over a slow-spinning gold ring, breathing aura
// and a twinkling spark; #2 and #3 get matched laurel wreaths over static
// metal rings with their own motion signatures — a platinum glint sweep
// and a warm bronze ember breathe. Below the podium this renders the
// plain row avatar unchanged. Per-item styled-jsx (the PlateCard
// pattern): the keyframes only ship when a medal row actually renders.
// Every decoration is absolutely positioned off the h-9 w-9 wrapper so
// the pilot column never shifts, and every glow alpha rides --lb-glow so
// light mode drops the neon.

import { Avatar } from './Avatar'
import { IconCrownSolid, IconLaurel, IconSpark } from './icons'
import { medalA, medalFor, medalGlow, type LeaderRow } from './types'

export function RankAvatar({ user }: { user: LeaderRow }) {
  const medal = medalFor(user.rank)
  const round = user.tier === 'TEAM' ? 'rounded-md' : 'rounded-full'
  const char = user.username[0]?.toUpperCase() ?? '?'

  if (!medal) {
    return (
      <Avatar
        src={user.profile_image}
        char={char}
        handle={user.username}
        imgClassName={`h-9 w-9 shrink-0 ${round} border border-zinc-800 object-cover`}
        fallbackClassName={`flex h-9 w-9 shrink-0 items-center justify-center ${round} border border-zinc-800 bg-zinc-900 font-display text-[11px] text-zinc-400`}
      />
    )
  }

  const champion = user.rank === 1
  // The 2px ring sits one radius step out so TEAM rounded-square rings
  // stay concentric with the rounded-md avatar (podium's xl-over-lg step).
  const ringRound = user.tier === 'TEAM' ? 'rounded-lg' : 'rounded-full'
  const ring = champion
    ? `conic-gradient(from 0deg, ${medalA(medal.rgb, 0.35)}, ${medalA(medal.rgb, 0.95)} 80deg, ${medalA(medal.rgb, 1)} 120deg, ${medalA(medal.rgb, 0.4)} 200deg, ${medalA(medal.rgb, 0.85)} 290deg, ${medalA(medal.rgb, 0.35)})`
    : `conic-gradient(from 210deg, ${medalA(medal.rgb, 0.85)}, ${medalA(medal.rgb, 0.22)}, ${medalA(medal.rgb, 0.85)})`

  return (
    <span className="relative h-9 w-9 shrink-0">
      {champion && (
        <span
          aria-hidden
          className={`rk-aura absolute -inset-1 ${ringRound}`}
          style={{ boxShadow: `0 0 16px 3px ${medalGlow(medal.rgb, 0.5)}` }}
        />
      )}
      {user.rank === 3 && (
        <span
          aria-hidden
          className={`rk-ember absolute -inset-1 ${ringRound}`}
          style={{ boxShadow: `0 0 12px 2px ${medalGlow(medal.rgb, 0.55)}` }}
        />
      )}
      {/* ring band — the wrapper clips an oversized conic layer to the
          ring shape (rotations stay compositor-only and TEAM squares
          never wobble); the opaque avatar covers the interior, leaving a
          2px metal band. Same trick as the podium, no inner keyline. */}
      <span
        aria-hidden
        className={`absolute -inset-[2px] overflow-hidden ${ringRound}`}
        style={{ boxShadow: `0 0 10px ${medalGlow(medal.rgb, champion ? 0.4 : 0.25)}` }}
      >
        <span
          className={`absolute -inset-[30%] ${champion ? 'rk-spin' : ''}`}
          style={{ background: ring }}
        />
        {user.rank === 2 && (
          <span
            className="rk-glint absolute -inset-[30%]"
            style={{
              background: `conic-gradient(from 0deg, transparent 328deg, ${medalA(medal.rgb, 0.95)} 348deg, transparent 360deg)`
            }}
          />
        )}
      </span>
      <Avatar
        src={user.profile_image}
        char={char}
        handle={user.username}
        imgClassName={`absolute inset-0 h-9 w-9 ${round} object-cover`}
        fallbackClassName={`absolute inset-0 flex h-9 w-9 items-center justify-center ${round} bg-zinc-900 font-display text-[11px] text-zinc-400`}
      />
      {champion ? (
        <>
          {/* crown floats in the row's 16px top padding; the tilt lives in
              the keyframes so the bob can rock around it */}
          <span
            aria-hidden
            className="rk-crown absolute -left-[7px] -top-[9px]"
            style={{
              color: medal.fg,
              filter: `drop-shadow(0 0 4px ${medalGlow(medal.rgb, 0.7)})`
            }}
          >
            <IconCrownSolid size={14} className="block" />
          </span>
          <span
            aria-hidden
            className="rk-spark absolute -left-[6px] -top-[12px]"
            style={{
              color: medal.fg,
              filter: `drop-shadow(0 0 3px ${medalGlow(medal.rgb, 0.8)})`
            }}
          >
            <IconSpark size={7} className="block" />
          </span>
        </>
      ) : (
        <span
          aria-hidden
          className="rk-laurel absolute -bottom-[5px] left-1/2 -translate-x-1/2"
          style={{
            color: medal.fg,
            filter: `drop-shadow(0 0 3px ${medalGlow(medal.rgb, 0.45)})`
          }}
        >
          <IconLaurel size={44} className="block" />
        </span>
      )}
      <style jsx global>{`
        /* 10s, not the podium's 3.4s — a full page of rows must stay calm */
        .rk-spin {
          animation: rk-spin 10s linear infinite;
        }
        @keyframes rk-spin {
          to {
            transform: rotate(360deg);
          }
        }

        /* #2 — light catching polished metal: the wedge sweeps the ring
           once, then rests as a static specular highlight */
        .rk-glint {
          animation: rk-glint-sweep 7.2s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
        }
        @keyframes rk-glint-sweep {
          0% {
            transform: rotate(0deg);
          }
          24%,
          100% {
            transform: rotate(360deg);
          }
        }

        .rk-aura {
          animation: rk-aura-breathe 5.2s ease-in-out infinite;
        }
        @keyframes rk-aura-breathe {
          0%,
          100% {
            opacity: 0.55;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.07);
          }
        }

        /* #3 — warm ember breathe, slower and dimmer than the champion */
        .rk-ember {
          animation: rk-ember-breathe 4.5s ease-in-out infinite;
        }
        @keyframes rk-ember-breathe {
          0%,
          100% {
            opacity: 0.3;
          }
          50% {
            opacity: 0.95;
          }
        }

        .rk-crown {
          transform: rotate(-22deg);
          animation: rk-crown-bob 3.6s ease-in-out infinite;
        }
        @keyframes rk-crown-bob {
          0%,
          100% {
            transform: translateY(0) rotate(-24deg);
          }
          50% {
            transform: translateY(-1.6px) rotate(-17deg);
          }
        }

        .rk-spark {
          opacity: 0;
          animation: rk-spark-twinkle 4.2s ease-in-out 1.2s infinite;
        }
        @keyframes rk-spark-twinkle {
          0%,
          30%,
          100% {
            opacity: 0;
            transform: scale(0.4);
          }
          10% {
            opacity: 1;
            transform: scale(1.1);
          }
          20% {
            opacity: 0.15;
            transform: scale(0.6);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .rk-spin,
          .rk-glint,
          .rk-aura,
          .rk-ember,
          .rk-crown,
          .rk-spark {
            animation: none;
          }
          /* motion-only artifacts — the static rings and wreaths stay */
          .rk-glint {
            opacity: 0;
          }
        }
      `}</style>
    </span>
  )
}
