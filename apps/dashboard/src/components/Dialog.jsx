import React from 'react';

export default function Dialog({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;

  return (
    <dialog open className="open">
      <div className="dialog-head">
        <h2>{title}</h2>
        <button className="btn small" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
