export default function DemoExpensePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '48px 24px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        background: 'linear-gradient(160deg, #f7f8ff 0%, #eef2ff 100%)',
        color: '#17213d',
      }}
    >
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <p style={{ margin: 0, color: '#667089', fontSize: 12, fontWeight: 700 }}>DEMO</p>
        <h1 style={{ margin: '8px 0 12px', fontSize: 32 }}>Expense claim</h1>
        <p style={{ marginBottom: 28, color: '#5b647e' }}>
          Local page for H09AAPPLE-80 walkthrough testing. Use the extension overlay Q&A here.
        </p>

        <form
          action="#"
          style={{
            display: 'grid',
            gap: 16,
            padding: 20,
            borderRadius: 16,
            background: 'rgba(255,255,255,0.9)',
            border: '1px solid #dfe4fb',
          }}
        >
          <button
            type="button"
            data-testid="new-expense"
            style={{
              justifySelf: 'start',
              padding: '10px 14px',
              border: 0,
              borderRadius: 10,
              background: '#5965f3',
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            New Expense
          </button>

          <label style={{ display: 'grid', gap: 6, fontSize: 14 }}>
            Receipt
            <input type="file" accept="image/*" />
          </label>

          <label style={{ display: 'grid', gap: 6, fontSize: 14 }}>
            Amount
            <input
              type="number"
              placeholder="0.00"
              style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #cfd6ef' }}
            />
          </label>

          <button
            type="submit"
            style={{
              justifySelf: 'start',
              padding: '10px 14px',
              border: 0,
              borderRadius: 10,
              background: '#18213d',
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Submit
          </button>
        </form>
      </div>
    </main>
  );
}
