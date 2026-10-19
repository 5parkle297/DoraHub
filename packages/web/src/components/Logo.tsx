/** DoraHub logo「半脸 D · 三须 · 弧嘴」（2026-10-18 定稿）。
 * 大圆半脸（碗凸向右，直边=脸中线）= 机器猫半边脸 & Dora 的 D；
 * 红鼻 = 云端 hub；三须 = workpc/laptop/phone 三台设备；
 * 弧嘴 = 咧嘴笑右半，从脸中线长出。
 * 内联 SVG（currentColor 跟随文字色，脸线/墨线用固定色保证浅深底都对）。 */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="15" fill="var(--logo-bg, #f4f1e9)" />
      <path
        d="M17 8.5a24.5 24.5 0 1 1 0 47"
        fill="var(--logo-face, #fffdf7)"
        stroke="var(--logo-blue, #2d8fc4)"
        stroke-width="5"
        stroke-linecap="round"
      />
      <path d="M17 8.5V55.5" fill="none" stroke="var(--logo-blue, #2d8fc4)" stroke-width="5" stroke-linecap="round" />
      <circle cx="26" cy="18.5" r="4.4" fill="var(--logo-nose, #c2372c)" />
      <g fill="none" stroke="var(--logo-ink, #1c1a17)" stroke-width="2.3" stroke-linecap="round">
        <path d="M31 25Q42 20.5 54 19" />
        <path d="M33 32Q45 32 57 32" />
        <path d="M31 36Q42 40 53 41.5" />
      </g>
      <path d="M17 43Q28 54 39 44.5" fill="none" stroke="var(--logo-ink, #1c1a17)" stroke-width="2.6" stroke-linecap="round" />
    </svg>
  );
}

/** 完整 lockup：logo + DoraHub 字标（侧栏/欢迎页用）。 */
export function LogoLockup({ size = 24, fontSize }: { size?: number; fontSize?: string }) {
  return (
    <span className="logo-lockup">
      <LogoMark size={size} />
      <span className="logo-word">
        Dora<span className="logo-hub">Hub</span>
      </span>
    </span>
  );
}
