import type { ReactNode } from 'react';

export interface PageProps {
  /** back to the main menu */
  back: () => void;
  /** last failed request */
  error: string;
}

/** A screen under the main menu: back button, title, error line, then its content. */
export function Page({ title, back, error, children }: PageProps & { title: string; children: ReactNode }) {
  return (
    <div className="barracks">
      <header>
        <button className="back" onClick={back}>← Menu</button>
        <h2>{title}</h2>
      </header>
      <p className="error" role="alert" hidden={!error}>{error}</p>
      {children}
    </div>
  );
}
