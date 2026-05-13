// Shared data, icons, and tokens used across all three variations

// Monochrome palette — one near-black ink, warm paper tones.
// Any hint of color comes from a single accent, used sparingly.
const INK = '#111111';
const INK_MUTED = 'rgba(17,17,17,0.55)';
const INK_FAINT = 'rgba(17,17,17,0.32)';
const HAIRLINE = 'rgba(17,17,17,0.09)';
const CANVAS = '#F3F1EC';
const CANVAS_DEEP = '#EAE6DD';
const PAPER = '#FBFAF6';
const ACCENT = '#111111';
const ACCENT_SOFT = 'rgba(17,17,17,0.05)';
const ACCENT_DEEP = '#000';

// Shared meeting corpus — same items appear in all variations so users can
// compare how each design surfaces the same information.
const MEETINGS = [
  {
    id: 'm1',
    title: 'Q2 產品規劃 Review',
    when: '今天 14:30',
    duration: '48 min',
    status: 'transcribing',     // 轉錄中
    progress: 0.68,
    participants: ['Ava', 'Ken', 'Jerry', 'Maya', '+2'],
    tags: ['Product', '週會'],
    lastLine: 'Ken：我覺得這個 milestone 應該拉到 Q3 第一週...',
  },
  {
    id: 'm2',
    title: 'Design Critique — Onboarding',
    when: '昨天 10:00',
    duration: '1h 12min',
    status: 'ready',            // 已完成
    progress: 1,
    participants: ['Maya', 'Jerry', 'Ava'],
    tags: ['Design'],
    lastLine: '總結：調整首次開啟的 permission 順序，縮短到 3 步。',
  },
  {
    id: 'm3',
    title: '客戶訪談 · Trinity Labs',
    when: '4/21 週一 16:00',
    duration: '55 min',
    status: 'comparing',        // LLM 比對中
    progress: 0.82,
    participants: ['Ava', 'Client · Sophia', 'Client · Ray'],
    tags: ['User Research', 'External'],
    lastLine: 'Sophia：我們目前主要痛點是會議後的整理很花時間...',
  },
  {
    id: 'm4',
    title: 'Weekly 1:1 with Ken',
    when: '4/19',
    duration: '32 min',
    status: 'ready',
    progress: 1,
    participants: ['Ava', 'Ken'],
    tags: ['1:1'],
    lastLine: 'Action：下週回報 API gateway 的 spike 結果。',
  },
  {
    id: 'm5',
    title: 'Eng Sync — Infra',
    when: '4/18',
    duration: '41 min',
    status: 'ready',
    progress: 1,
    participants: ['Jerry', 'Ken', 'Teo', '+3'],
    tags: ['Engineering'],
    lastLine: 'Teo：監控儀表板可以在下週上線。',
  },
];

const VOICEPRINT_SENTENCES = [
  '你好，我是 __（請說出你的名字）。',
  '今天的天氣看起來很適合開會。',
  'The quick brown fox jumps over the lazy dog.',
  '一、二、三、四、五、六、七、八、九、十。',
  '謝謝大家，會議就先到這裡。',
];

// Avatars are all neutral — no per-person color coding.
const AVATAR_BG = 'rgba(17,17,17,0.08)';
const TEAM = [
  { name: 'Ava Chen', role: 'PM',  enrolled: true  },
  { name: 'Ken Liu',  role: 'Eng', enrolled: true  },
  { name: 'Jerry Wu', role: 'Eng', enrolled: true  },
  { name: 'Maya Tan', role: 'Design', enrolled: true },
  { name: 'Teo Park', role: 'Eng', enrolled: false },
  { name: 'Rin Ota',  role: 'Design', enrolled: false },
];

// ── Icons ───────────────────────────────────────────────
const Icon = {
  mic: (p = {}) => (
    <svg width={p.size || 20} height={p.size || 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>
    </svg>
  ),
  wave: (p = {}) => (
    <svg width={p.size || 20} height={p.size || 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}>
      <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2"/>
    </svg>
  ),
  clock: (p = {}) => (
    <svg width={p.size || 16} height={p.size || 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}>
      <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
    </svg>
  ),
  users: (p = {}) => (
    <svg width={p.size || 16} height={p.size || 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}>
      <circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M15 20c0-2.5 1.5-4 4-4"/>
    </svg>
  ),
  sparkle: (p = {}) => (
    <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5zM19 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z"/>
    </svg>
  ),
  search: (p = {}) => (
    <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}>
      <circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>
    </svg>
  ),
  plus: (p = {}) => (
    <svg width={p.size || 20} height={p.size || 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}>
      <path d="M12 5v14M5 12h14"/>
    </svg>
  ),
  play: (p = {}) => (
    <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M7 5l12 7-12 7z"/>
    </svg>
  ),
  check: (p = {}) => (
    <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 12l5 5L20 6"/>
    </svg>
  ),
  calendar: (p = {}) => (
    <svg width={p.size || 16} height={p.size || 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>
    </svg>
  ),
  settings: (p = {}) => (
    <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>
    </svg>
  ),
  send: (p = {}) => (
    <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 12l16-8-6 18-3-7-7-3z"/>
    </svg>
  ),
};

// Tiny presentational helpers used across variations
// Status now uses ink only — weight, glyph and subtle pulse differentiate.
function StatusDot({ status }) {
  const label = status === 'transcribing' ? '轉錄中' : status === 'comparing' ? '比對中' : '已完成';
  const animate = status !== 'ready';
  const filled = status === 'ready';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      color: INK, fontSize: 10.5, fontWeight: 500, letterSpacing: 0.3, textTransform: 'uppercase',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: 3,
        background: filled ? INK : 'transparent',
        border: filled ? 'none' : `1px solid ${INK}`,
        animation: animate ? 'mrPulse 1.4s ease-in-out infinite' : 'none',
      }}/>
      {label}
    </span>
  );
}

function Avatar({ name, size = 24 }) {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('');
  return (
    <div style={{
      width: size, height: size, borderRadius: size / 2, background: AVATAR_BG,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 600, color: INK,
      flexShrink: 0, letterSpacing: -0.2,
    }}>{initials}</div>
  );
}

function Tag({ children, tone = 'default' }) {
  return <span style={{
    fontSize: 10, fontWeight: 500, padding: '2px 7px', borderRadius: 3,
    background: 'transparent', color: INK_MUTED,
    border: `1px solid ${HAIRLINE}`, letterSpacing: 0.2, textTransform: 'uppercase',
  }}>{children}</span>;
}

// Inject shared keyframes once
if (typeof document !== 'undefined' && !document.getElementById('mr-shared-css')) {
  const s = document.createElement('style');
  s.id = 'mr-shared-css';
  s.textContent = `
    @keyframes mrPulse { 0%,100%{opacity:1} 50%{opacity:.35} }
    @keyframes mrWave { 0%,100%{transform:scaleY(0.4)} 50%{transform:scaleY(1)} }
    @keyframes mrRing { 0%{transform:scale(1);opacity:.5} 100%{transform:scale(1.6);opacity:0} }
    @keyframes mrShimmer { 0%{background-position:-200px 0} 100%{background-position:200px 0} }
    .mr-wave-bar { transform-origin: center; animation: mrWave 1s ease-in-out infinite; }
  `;
  document.head.appendChild(s);
}

Object.assign(window, {
  ACCENT, ACCENT_SOFT, ACCENT_DEEP, INK, INK_MUTED, INK_FAINT, HAIRLINE,
  CANVAS, CANVAS_DEEP, PAPER, AVATAR_BG,
  MEETINGS, VOICEPRINT_SENTENCES, TEAM,
  Icon, StatusDot, Avatar, Tag,
});
