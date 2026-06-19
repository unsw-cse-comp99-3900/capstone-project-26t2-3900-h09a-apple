type Props = {
  searchParams: Promise<{
    sessionId?: string;
  }>;
};

export default async function SopStatusPage({ searchParams }: Props) {
  const { sessionId } = await searchParams;

  return (
    <main>
      <p>WorkTrace AI</p>
      <h1>SOP generation queued</h1>
      <p>
        Your captured session has been submitted. The full SOP generation status panel will be
        completed in H09AAPPLE-19.
      </p>
      <p>Session ID: {sessionId ?? 'Unknown'}</p>
    </main>
  );
}
