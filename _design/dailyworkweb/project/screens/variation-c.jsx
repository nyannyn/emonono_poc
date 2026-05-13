// Variation C — 紙感優雅 × 一問即答
function VariationC() {
  return (
    <div style={{
      height: '100%', background: PAPER,
      display: 'flex', flexDirection: 'column',
      fontFamily: '-apple-system, "SF Pro Text", system-ui', color: INK,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '60px 26px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 10, letterSpacing: 2,
        color: INK_MUTED, textTransform: 'uppercase',
      }}>
        <span>Minute</span>
        <span>04 · 23</span>
      </div>

      {/* Single question */}
      <div style={{ padding: '20px 26px 0' }}>
        <div style={{ fontSize: 13, color: INK_MUTED, marginBottom: 10 }}>
          午安 Ava。
        </div>
        <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.9, lineHeight: 1.15 }}>
          要開始<br/>新會議嗎？
        </div>
      </div>

      <div style={{ flex: 1 }}/>

      {/* Two rounded buttons */}
      <div style={{ padding: '0 20px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button style={{
          padding: '18px 24px', borderRadius: 32, border: 'none', cursor: 'pointer',
          background: INK, color: PAPER,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          fontFamily: 'inherit',
        }}>
          <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.2 }}>開始錄音</span>
          <Icon.mic size={18}/>
        </button>

        <button style={{
          padding: '18px 24px', borderRadius: 32, border: 'none', cursor: 'pointer',
          background: 'transparent', color: INK,
          border: `1px solid ${HAIRLINE}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          fontFamily: 'inherit',
        }}>
          <span style={{ fontSize: 15, fontWeight: 500, letterSpacing: -0.15 }}>上傳音檔</span>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M5 3l4 4-4 4"/>
          </svg>
        </button>
      </div>

      {/* Footnote */}
      <div style={{
        padding: '14px 26px 34px',
        fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 10,
        letterSpacing: 1.5, color: INK_MUTED, textTransform: 'uppercase',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>§ 背景 · 1 個轉錄中</span>
        <span style={{
          width: 6, height: 6, borderRadius: 3, background: INK,
          animation: 'mrPulse 1.4s ease-in-out infinite',
        }}/>
      </div>
    </div>
  );
}
window.VariationC = VariationC;
