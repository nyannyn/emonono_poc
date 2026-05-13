// Variation B — 深色優雅版：masthead + 大圓角主卡
function VariationB() {
  return (
    <div style={{
      height: '100%', background: '#15140F',
      display: 'flex', flexDirection: 'column',
      fontFamily: '-apple-system, "SF Pro Text", system-ui', color: '#F3F1EC',
      overflow: 'hidden',
    }}>
      {/* Editorial masthead */}
      <div style={{
        padding: '60px 26px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 10, letterSpacing: 2,
        color: 'rgba(232,236,241,0.55)', textTransform: 'uppercase',
      }}>
        <span>Minute / Vol 07</span>
        <span>Ava</span>
      </div>

      {/* Hero card */}
      <div style={{ padding: '16px 20px 0' }}>
        <div style={{
          background: 'rgba(232,236,241,0.05)', borderRadius: 32, padding: '30px 26px',
          border: '0.5px solid rgba(232,236,241,0.1)',
        }}>
          <div style={{
            fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 10, letterSpacing: 1.5,
            color: 'rgba(232,236,241,0.55)', textTransform: 'uppercase', marginBottom: 14,
          }}>
            § 01 · Record
          </div>
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.8, lineHeight: 1.1 }}>
            開始新會議
          </div>
          <div style={{ fontSize: 13, color: 'rgba(232,236,241,0.6)', marginTop: 10, lineHeight: 1.55 }}>
            即時轉錄 · 聲紋辨識
          </div>
          <button style={{
            marginTop: 22, width: 60, height: 60, borderRadius: 30, border: 'none', cursor: 'pointer',
            background: '#F3F1EC', color: '#15140F',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon.mic size={22}/>
          </button>
        </div>
      </div>

      <div style={{ flex: 1 }}/>

      {/* Minimal status footer */}
      <div style={{
        padding: '0 26px 34px',
        borderTop: '0.5px solid rgba(232,236,241,0.1)',
        paddingTop: 16, marginTop: 16,
      }}>
        <div style={{
          fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 10, letterSpacing: 1.5,
          color: 'rgba(232,236,241,0.45)', textTransform: 'uppercase', marginBottom: 10,
        }}>
          § 02 · 背景任務
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: -0.15 }}>
            1 個會議轉錄中
          </div>
          <span style={{
            fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 11,
            color: 'rgba(232,236,241,0.6)',
          }}>
            查看 →
          </span>
        </div>
      </div>
    </div>
  );
}
window.VariationB = VariationB;
