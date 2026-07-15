function setText(id: string, value: string): void {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value;
  }
}

setText('platform', window.desktopAPI.platform);
setText('electron-version', window.desktopAPI.versions.electron);
setText('chrome-version', window.desktopAPI.versions.chrome);
setText('node-version', window.desktopAPI.versions.node);