// Variation — 優雅 × 簡約融合
// 保留：masthead header、章節編號、SF Mono 小字、粗細對比
// 改變：大圓角、留白、每畫面只留最核心資訊

function VariationA() {
  return (
    <div style={{
      height: '100%', background: CANVAS,
      display: 'flex', flexDirection: 'column',
      fontFamily: '-apple-system, "SF Pro Text", system-ui', color: INK,
      overflow: 'hidden', position: 'relative',
    }}>
      {/* Editorial masthead */}
      <div style={{
        padding: '60px 26px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 10, letterSpacing: 2,
        color: INK_MUTED, textTransform: 'uppercase',
      }}>
        <span>Minute</span>
        <span>Apr 23</span>
      </div>

      {/* Lede */}
      <div style={{ padding: '12px 26px 0' }}>
        <div style={{ fontSize: 13, color: INK_MUTED, letterSpacing: -0.1, marginBottom: 8 }}>
          午安，Ava。
        </div>
        <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: -1.2, lineHeight: 1.05 }}>
          要開始<br/>新會議嗎？
        </div>
      </div>

      <div style={{ flex: 1 }}/>

      {/* Action — single rounded pill */}
      <div style={{ padding: '0 20px 14px' }}>
        <button style={{
          width: '100%', padding: '16px 22px', borderRadius: 36, border: 'none', cursor: 'pointer',
          background: INK, color: PAPER,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          fontFamily: 'inherit',
          boxShadow: '0 24px 48px -24px rgba(0,0,0,0.4)',
        }}>
          <div style={{ textAlign: 'left' }}>
            <div style={{
              fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 9.5, letterSpacing: 1.5,
              opacity: 0.55, textTransform: 'uppercase',
            }}>§ 01</div>
            <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: -0.3, marginTop: 2 }}>
              開始錄音
            </div>
          </div>
          <div style={{
            width: 44, height: 44, borderRadius: 22, background: PAPER, color: INK,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Icon.mic size={20}/>
          </div>
        </button>
      </div>

      {/* One gentle status line */}
      <div style={{ padding: '0 20px 34px' }}>
        <div style={{
          padding: '14px 20px', borderRadius: 22,
          background: PAPER,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: 3, background: INK,
            animation: 'mrPulse 1.4s ease-in-out infinite', flexShrink: 0,
          }}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 9.5,
              letterSpacing: 1.5, color: INK_MUTED, textTransform: 'uppercase',
            }}>
              § 02 · 進行中
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, marginTop: 3, letterSpacing: -0.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {MEETINGS[0].title}
            </div>
          </div>
          <span style={{
            fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 11,
            color: INK_MUTED, letterSpacing: 0.5,
          }}>
            {Math.round(MEETINGS[0].progress * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}
window.VariationA = VariationA;
