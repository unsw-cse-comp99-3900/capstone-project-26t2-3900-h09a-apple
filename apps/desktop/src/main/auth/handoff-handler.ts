import { redeemHandoffCode } from './auth-service';

const HANDOFF_HOST = 'auth-callback';

/**
 * Handle a WorkTrace protocol URL.
 */
export async function handleProtocolUrl(url: string): Promise<boolean> {
  let parsed: URL;
  console.log("Protocol URL:", url);
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'worktrace:') {
    return false;
  }

  if (parsed.hostname !== HANDOFF_HOST) {
    return false;
  }

  // const code = parsed.searchParams.get('code');

  // if (!code) {
  //   return false;
  // }

  // await redeemHandoffCode(code);

  console.log("Protocol:", parsed.protocol);
  console.log("Host:", parsed.hostname);

  const code = parsed.searchParams.get('code');
  console.log("Code:", code);
  if (!code) {
    return false;
  }
  await redeemHandoffCode(code);

  console.log("Redeem finished");

  return true;
}