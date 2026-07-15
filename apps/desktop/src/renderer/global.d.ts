interface DesktopAPI {
  platform: NodeJS.Platform;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
}

interface Window {
  desktopAPI: DesktopAPI;
}