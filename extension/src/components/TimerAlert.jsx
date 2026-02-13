export function TimerAlert({ talkRatio, nextStepAlerts = [], summaryLines = [] }) {
  return (
    <section className="overlay-card">
      <h3>Coaching temps reel</h3>
      <p>
        Ratio talk/listen: <strong>{talkRatio?.seller ?? 0}% vendeur</strong> / {talkRatio?.buyer ?? 0}% prospect
      </p>
      <ul>
        {(nextStepAlerts.length ? nextStepAlerts : ['Aucune alerte critique.']).map((item, index) => (
          <li key={`n-${index}`}>{item}</li>
        ))}
      </ul>

      <h4>Resume minute (max 20 lignes)</h4>
      <ul>
        {(summaryLines.length ? summaryLines.slice(0, 20) : ['Resume en attente...']).map((line, index) => (
          <li key={`r-${index}`}>{line}</li>
        ))}
      </ul>
    </section>
  )
}
