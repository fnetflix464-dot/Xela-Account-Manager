import React, { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import '../styles/WindowControls.css';

const appWindow = getCurrentWindow();

function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlisten;
    let cancelled = false;

    appWindow.isMaximized().then((value) => {
      if (!cancelled) setIsMaximized(value);
    });

    appWindow
      .onResized(() => {
        appWindow.isMaximized().then((value) => {
          if (!cancelled) setIsMaximized(value);
        });
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  return (
    <div className="window-controls">
      <button className="window-control-btn" title="Minimize" onClick={() => appWindow.minimize()}>
        <span className="window-control-icon window-control-icon-min" />
      </button>
      <button
        className="window-control-btn"
        title={isMaximized ? 'Restore' : 'Maximize'}
        onClick={() => appWindow.toggleMaximize()}
      >
        <span className={`window-control-icon ${isMaximized ? 'window-control-icon-restore' : 'window-control-icon-max'}`} />
      </button>
      <button
        className="window-control-btn window-control-btn-close"
        title="Close"
        onClick={() => appWindow.close()}
      >
        <span className="window-control-icon window-control-icon-close" />
      </button>
    </div>
  );
}

export default WindowControls;
