export function SuggestionBox({ suggestions = [], objections = [], battleCards = [] }) {
  return (
    <section className="overlay-card">
      <h3>Souffleur intelligent</h3>
      <ul>
        {suggestions.map((item, index) => (
          <li key={`s-${index}`}>{item}</li>
        ))}
      </ul>

      {objections.length ? (
        <>
          <h4>Objections detectees</h4>
          <ul>
            {objections.map((item, index) => (
              <li key={`o-${index}`}>{item}</li>
            ))}
          </ul>
        </>
      ) : null}

      {battleCards.length ? (
        <>
          <h4>Battle cards</h4>
          <ul>
            {battleCards.map((item, index) => (
              <li key={`b-${index}`}>{item}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
