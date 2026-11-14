import { useRef, useState } from 'react';
import { api, type Account } from '../api';

export function Auth({ message, onEnter }: { message: string; onEnter: (account: Account) => void }) {
  const email = useRef<HTMLInputElement>(null), password = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState(message);
  const [shown, setShown] = useState(false);

  const send = async (request: (email: string, password: string) => Promise<Account>) => {
    const e = email.current!, p = password.current!;
    // our own messages, in the game's style, instead of the browser's tooltip
    const bad = !e.validity.valid ? [e, 'Scrivi un indirizzo email valido.'] as const
      : !p.validity.valid ? [p, 'La password deve avere almeno 8 caratteri.'] as const : null;
    if (bad) {
      setProblem(bad[1]);
      return bad[0].focus();
    }
    try {
      onEnter(await request(e.value, p.value));
    } catch (err) {
      setProblem((err as Error).message);
      p.value = '';
    }
  };

  return (
    <form className="menu-main auth" noValidate onSubmit={e => { e.preventDefault(); void send(api.login); }}>
      <h1 className="title">Tactics</h1>
      <input ref={email} type="email" name="email" autoComplete="email" required placeholder="Email" />
      <div className="pw">
        <input ref={password} type={shown ? 'text' : 'password'} name="password" autoComplete="current-password" required minLength={8} placeholder="Password (almeno 8 caratteri)" />
        <button type="button" className="reveal" onClick={() => setShown(!shown)}>{shown ? 'Nascondi' : 'Mostra'}</button>
      </div>
      <p className="error" role="alert" hidden={!problem}>{problem}</p>
      <button className="menu-btn primary" type="submit">Accedi</button>
      <p className="hint or">Prima volta qui?</p>
      <button className="menu-btn" type="button" onClick={() => void send(api.register)}>Crea account</button>
    </form>
  );
}
