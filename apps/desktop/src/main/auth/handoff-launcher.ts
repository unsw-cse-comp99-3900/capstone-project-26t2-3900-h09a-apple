import { shell } from 'electron';
import { WEB_APP_URL } from '../config';

export async function launchHandoff(): Promise<void> {
  const url = new URL('/login', WEB_APP_URL);

  await shell.openExternal(url.toString());
}
