const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'H09A Apple';
const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export default function HomePage() {
  return (
    <main>
      <h1>{APP_NAME}</h1>
      <p>Frontend is up. Backend should be running at {API_URL}.</p>
    </main>
  );
}
