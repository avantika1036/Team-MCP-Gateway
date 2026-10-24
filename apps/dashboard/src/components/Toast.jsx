import React, { useEffect, useState } from 'react';

export default function Toast({ message, bad = false, duration = 4200, onClose }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      if (onClose) onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  if (!visible) return null;

  return (
    <div className={`toast ${bad ? 'bad' : ''}`} role="status">
      {message}
    </div>
  );
}
