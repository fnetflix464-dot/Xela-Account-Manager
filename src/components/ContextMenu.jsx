import React, { useEffect, useRef, useState } from 'react';
import '../styles/ContextMenu.css';

/**
 * A small right-click context menu positioned at (x, y) - the caller
 * supplies `items` as `{ label, icon, danger, onClick }`. Closes itself
 * on an outside click, Escape, or after an item is chosen. Clamps its
 * position on mount so it never renders off the edge of the window.
 */
function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ top: y, left: x, visible: false });

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    setPosition({
      left: Math.min(x, maxLeft),
      top: Math.min(y, maxTop),
      visible: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  useEffect(() => {
    const handlePointerDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="context-menu"
      ref={ref}
      style={{ top: position.top, left: position.left, opacity: position.visible ? 1 : 0 }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          className={`context-menu-item ${item.danger ? 'danger' : ''}`}
          onClick={() => {
            onClose();
            item.onClick();
          }}
        >
          {item.icon && <span className="context-menu-icon">{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  );
}

export default ContextMenu;
