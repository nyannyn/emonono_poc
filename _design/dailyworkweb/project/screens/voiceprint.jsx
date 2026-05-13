// Voiceprint — 優雅簡約融合
function VoiceprintScreen() {
  const [recording, setRecording] = React.useState(false);
  const currentIdx = 1;
  const total = VOICEPRINT_SENTENCES.length;

  return (
    <div style={{
      height: '100%', background: CANVAS,
      display: 'flex', flexDirection: 'column',
      fontFamily: '-apple-system, "SF Pro Text", system-ui', color: INK,
      overflow: 'hidden',
    }}>
      {/* Masthead */}
      <div style={{
        padding: '60px 26px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 10, letterSpacing: 2,
        color: INK_MUTED, textTransform: 'uppercase',
      }}>
        <button style={{
          border: 'none', background: 'none', color: INK, cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit',
        }}>
          ← 返回
        </button>
        <span>聲紋 · {String(currentIdx + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
      </div>

      {/* Intro */}
      <div style={{ padding: '16px 26px 0' }}>
        <div style={{
          fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 10, letterSpacing: 1.5,
          color: INK_MUTED, textTransform: 'uppercase', marginBottom: 10,
        }}>
          § 請唸出
        </div>
      </div>

      {/* Big rounded sentence card */}
      <div style={{ padding: '16px 20px 0' }}>
        <div style={{
          background: PAPER, borderRadius: 32, padding: '36px 28px',
          boxShadow: '0 1px 0 rgba(0,0,0,0.02), 0 24px 48px -28px rgba(0,0,0,0.15)',
        }}>
          <div style={{ fontSize: 24, fontWeight: 500, lineHeight: 1.4, letterSpacing: -0.4, textWrap: 'pretty' }}>
            {VOICEPRINT_SENTENCES[currentIdx]}
          </div>
        </div>
      </div>

      <div style={{ flex: 1 }}/>

      {/* Waveform */}
      <div style={{
        padding: '0 26px 14px', height: 48,
        display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 3,
      }}>
        {Array.from({ length: 30 }).map((_, i) => {
          const h = recording ? 8 + Math.abs(Math.sin(i * 0.7) * 28) : 4 + Math.abs(Math.sin(i) * 5);
          return (
            <div key={i} className={recording ? 'mr-wave-bar' : ''} style={{
              width: 3, height: h, borderRadius: 1.5, background: recording ? INK : INK_FAINT,
              animationDelay: `${i * 0.05}s`,
            }}/>
          );
        })}
      </div>

      {/* Record */}
      <div style={{ padding: '4px 0 44px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <button
          onClick={() => setRecording(!recording)}
          style={{
            width: 78, height: 78, borderRadius: 39, border: 'none', cursor: 'pointer',
            background: INK, color: PAPER,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 20px 40px -16px rgba(0,0,0,0.4)',
          }}>
          {recording ? (
            <div style={{ width: 22, height: 22, borderRadius: 6, background: PAPER }}/>
          ) : (
            <Icon.mic size={28}/>
          )}
        </button>
        <div style={{
          fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 10, letterSpacing: 1.5,
          color: INK_MUTED, textTransform: 'uppercase',
        }}>
          {recording ? 'REC · 00:03' : '按一下開始'}
        </div>
      </div>
    </div>
  );
}
window.VoiceprintScreen = VoiceprintScreen;
