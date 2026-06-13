export default function HomePage() {
  return (
    <main>
      <h1>H09A Apple</h1>
      <p>Frontend is up. Backend should be running at {process.env.NEXT_PUBLIC_API_BASE_URL}.</p>
    </main>
  );
}
