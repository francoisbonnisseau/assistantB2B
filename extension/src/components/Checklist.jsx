function ScoreRow({ label, value }) {
  const safeValue = Math.max(0, Math.min(100, value ?? 0))
  return (
    <div className="score-row">
      <div className="score-label">
        <span>{label}</span>
        <strong>{safeValue}%</strong>
      </div>
      <div className="score-track">
        <div className="score-fill" style={{ width: `${safeValue}%` }} />
      </div>
    </div>
  )
}

export function Checklist({ frameworkScores, missingSignals }) {
  return (
    <section className="overlay-card">
      <h3>Qualification live</h3>
      <ScoreRow label="MEDDIC" value={frameworkScores?.meddic} />
      <ScoreRow label="BANT" value={frameworkScores?.bant} />
      <ScoreRow label="SPICED" value={frameworkScores?.spiced} />

      <h4>Signaux manquants</h4>
      <ul>
        {(missingSignals?.length ? missingSignals : ['Aucun signal critique manquant pour l\'instant.']).map(
          (item, index) => (
            <li key={`m-${index}`}>{item}</li>
          ),
        )}
      </ul>
    </section>
  )
}
